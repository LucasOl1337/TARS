"""Agent — o loop agêntico do TARS (plan → act → observe → verify → repeat).

Este é o coração da visão: dado um objetivo com critério de sucesso explícito,
o TARS age em ciclo, observa o resultado de cada ação, e ITERA até o objetivo
ser verificado como cumprido — ou até estourar o orçamento (anti-loop-infinito).

Protocolo (provider-agnóstico, em vez de function-calling nativo p/ rodar igual
em GLM/Kimi/Anthropic/OpenRouter): a cada turno o modelo devolve UM objeto JSON
  {"thought": str, "action": "tool"|"finish", "tool_id": str, "input": obj,
   "final_answer": str}
O executor roda a ferramenta, anexa a observação, e repete.

Verificação (Fase 1): quando o modelo diz "finish", um VERIFICADOR separado —
com prompt adversarial ("prove que NÃO concluí") — confere contra o
definition_of_done. Se reprovar, o feedback volta como observação e o loop
continua. Quem executa não é quem aprova.
"""
from __future__ import annotations

import json
import time
from typing import Any

import config
from event_store import append_event
import memory as memory_mod
from brain import build_system_prompt, dispatch_llm, provider_for_model
from db import get_conn, row_to_persona
from governance import kill_switch_engaged, policy_summary
from goals import add_step, bump_counters, get_goal, update_goal
from tools import execute_tool, tools_by_id

PERSONA_SLUG = "tars"


# --------------------------------------------------------------------------- #
# Helpers                                                                      #
# --------------------------------------------------------------------------- #

def _load_persona() -> dict[str, Any]:
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM personas WHERE slug = ?", (PERSONA_SLUG,)).fetchone()
    finally:
        conn.close()
    return row_to_persona(row) if row else {"name": "TARS"}


def _executable_tools() -> list[dict[str, Any]]:
    rows = []
    for tool in tools_by_id().values():
        invoke = tool.get("invoke") or {}
        if invoke.get("type") not in ("builtin", "bridge"):
            continue
        rows.append({
            "id": tool.get("id"),
            "description": tool.get("description") or tool.get("name"),
            "when_to_use": tool.get("prompt_instruction") or "",
            "parameters": tool.get("parameters") or {},
        })
    rows.sort(key=lambda t: str(t.get("id")))
    return rows


def _tokens(usage: Any) -> int:
    if not isinstance(usage, dict):
        return 0
    if usage.get("total_tokens"):
        return int(usage["total_tokens"])
    return int(usage.get("input_tokens", 0) or usage.get("prompt_tokens", 0) or 0) + \
           int(usage.get("output_tokens", 0) or usage.get("completion_tokens", 0) or 0)


def _parse_action(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:]
    raw = raw.strip()
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    start, end = raw.find("{"), raw.rfind("}")
    if 0 <= start < end:
        try:
            obj = json.loads(raw[start:end + 1])
            return obj if isinstance(obj, dict) else None
        except Exception:
            return None
    return None


def _runtime_system(persona: dict[str, Any], goal: dict[str, Any]) -> str:
    tools = _executable_tools()
    tools_json = json.dumps(tools, ensure_ascii=False, indent=0)
    mem = memory_mod.context_block(query=f"{goal.get('title','')} {goal.get('description','')}", limit=6)
    parts = [
        build_system_prompt(persona),
        "# Runtime autônomo",
        "Você opera em um LOOP autônomo de execução de objetivo. A cada turno você "
        "responde com EXATAMENTE UM objeto JSON — nada de texto fora do JSON, nada "
        "de markdown. Formato:",
        '{"thought": "raciocínio curto", "action": "tool" | "finish", '
        '"tool_id": "<id>", "input": { ... }, "final_answer": "<só quando action=finish>"}',
        "Regras do loop:",
        "- Use uma ferramenta por turno (action=tool) para progredir no objetivo.",
        "- Observe o resultado da ferramenta no próximo turno antes de decidir.",
        "- NÃO repita uma ação que acabou de falhar — adapte a estratégia.",
        "- Quando o critério de sucesso (definition_of_done) estiver atendido, use "
        "action=finish e descreva em final_answer a EVIDÊNCIA concreta do que foi feito.",
        "- Se algo for bloqueado pela governança, não insista: relate no final_answer "
        "o que precisaria de aprovação humana.",
        "- Pense no orçamento: você tem um número limitado de iterações.",
        policy_summary(),
        "## Ferramentas disponíveis\n" + tools_json,
    ]
    if mem:
        parts.append(mem)
    return "\n\n".join(p for p in parts if p)


def _goal_kickoff(goal: dict[str, Any]) -> str:
    dod = goal.get("definition_of_done") or "(não especificado — entregue um resultado claro e verificável)"
    return (
        f"OBJETIVO: {goal['title']}\n\n"
        f"DESCRIÇÃO: {goal.get('description') or '(sem detalhes adicionais)'}\n\n"
        f"CRITÉRIO DE SUCESSO (definition_of_done): {dod}\n\n"
        "Comece. Responda com o primeiro objeto JSON de ação."
    )


# --------------------------------------------------------------------------- #
# Verificador (Fase 1) — separado do executor                                  #
# --------------------------------------------------------------------------- #

async def verify_goal(
    goal: dict[str, Any],
    final_answer: str,
    transcript: list[dict[str, str]],
    provider: str,
    send_model: str,
) -> dict[str, Any]:
    dod = (goal.get("definition_of_done") or "").strip()
    if not dod:
        return {"passed": True, "reason": "sem definition_of_done — finish aceito",
                "missing": [], "lenient": True}

    # Compacta a trilha p/ o verificador (só ações/observações, sem ruído).
    evidence = []
    for m in transcript:
        if m["role"] == "assistant":
            evidence.append("AÇÃO: " + m["content"][:600])
        elif m["role"] == "user" and m["content"].startswith("OBSERVAÇÃO"):
            evidence.append(m["content"][:800])
    evidence_text = "\n".join(evidence[-16:])

    system = (
        "Você é o VERIFICADOR adversarial do TARS. Seu trabalho é tentar PROVAR que "
        "o objetivo NÃO foi cumprido. Seja cético: só aprove se a evidência concreta "
        "no histórico satisfizer o critério de sucesso. Suspeita de 'alucinação de "
        "sucesso' (o executor dizer que fez sem evidência). Responda só com JSON: "
        '{"passed": bool, "reason": str, "missing": [str]}'
    )
    user = (
        f"CRITÉRIO DE SUCESSO:\n{dod}\n\n"
        f"RESPOSTA FINAL DO EXECUTOR:\n{final_answer}\n\n"
        f"EVIDÊNCIA (trilha de ações/observações):\n{evidence_text}\n\n"
        "O critério foi objetivamente cumprido? Responda com o JSON."
    )
    try:
        result = await dispatch_llm(provider, send_model, system,
                                    [{"role": "user", "content": user}], 0.1, 1200)
        verdict = _parse_action(result.get("content", "")) or {}
    except Exception as exc:  # noqa: BLE001
        return {"passed": False, "reason": f"verificador falhou: {exc}", "missing": []}
    return {
        "passed": bool(verdict.get("passed", False)),
        "reason": str(verdict.get("reason") or ""),
        "missing": verdict.get("missing") if isinstance(verdict.get("missing"), list) else [],
        "tokens": _tokens(result.get("usage")),
    }


# --------------------------------------------------------------------------- #
# Loop principal                                                               #
# --------------------------------------------------------------------------- #

async def run_goal(goal_id: str) -> dict[str, Any]:
    goal = get_goal(goal_id)
    if not goal:
        return {"ok": False, "error": "goal não encontrado"}
    if goal["status"] in ("done", "cancelled"):
        return {"ok": True, "status": goal["status"], "result": goal.get("result"),
                "verifier": goal.get("verifier")}

    persona = _load_persona()
    provider, send_model = provider_for_model(persona.get("model") or config.TARS_MODEL)
    if not provider:
        update_goal(goal_id, status="failed", error="nenhum provider LLM configurado")
        return {"ok": False, "status": "failed", "error": "nenhum provider LLM configurado"}

    update_goal(goal_id, status="running", started_at=__import__("db").now_iso())
    append_event(
        "goal.run_started",
        {"title": goal.get("title"), "max_iterations": goal.get("max_iterations")},
        goal_id=goal_id,
        trace_id=goal.get("trace_id"),
        source="agent",
    )

    system = _runtime_system(persona, goal)
    transcript: list[dict[str, str]] = [{"role": "user", "content": _goal_kickoff(goal)}]
    started = time.time()
    idx = 0
    max_iter = int(goal["max_iterations"])
    max_seconds = int(goal["max_seconds"])
    max_tools = int(goal["max_tool_calls"])
    tool_calls = 0
    final_status = "failed"
    final_result = ""
    last_verifier: dict[str, Any] | None = None

    while True:
        # ----- guardas de orçamento / kill-switch ----------------------------
        if kill_switch_engaged():
            final_status, final_result = "cancelled", "kill-switch ativado durante a execução"
            break
        if idx >= max_iter:
            final_status, final_result = "failed", f"orçamento de iterações esgotado ({max_iter})"
            break
        if time.time() - started > max_seconds:
            final_status, final_result = "failed", f"orçamento de tempo esgotado ({max_seconds}s)"
            break
        if tool_calls >= max_tools:
            final_status, final_result = "failed", f"orçamento de tool-calls esgotado ({max_tools})"
            break

        # ----- planejar próxima ação -----------------------------------------
        try:
            plan = await dispatch_llm(provider, send_model, system, transcript, 0.2, 2000)
        except Exception as exc:  # noqa: BLE001
            final_status, final_result = "failed", f"falha no planejador: {exc}"
            break
        raw = str(plan.get("content") or "")
        bump_counters(goal_id, iterations=1, tokens=_tokens(plan.get("usage")))
        idx += 1
        transcript.append({"role": "assistant", "content": raw})

        decision = _parse_action(raw)
        if not decision:
            add_step(goal_id, idx, "error", thought=raw[:500], action="parse_error", ok=False)
            transcript.append({"role": "user", "content":
                "OBSERVAÇÃO: resposta não era JSON válido. Responda APENAS com o objeto JSON de ação."})
            continue

        thought = str(decision.get("thought") or "")
        action = str(decision.get("action") or "").lower().strip()

        # ----- finish → verificar --------------------------------------------
        if action == "finish":
            final_answer = str(decision.get("final_answer") or decision.get("answer") or thought)
            update_goal(goal_id, status="verifying")
            append_event(
                "verification.started",
                {"definition_of_done": bool(goal.get("definition_of_done"))},
                goal_id=goal_id,
                trace_id=goal.get("trace_id"),
                source="verifier",
            )
            verdict = await verify_goal(goal, final_answer, transcript, provider, send_model)
            last_verifier = verdict
            bump_counters(goal_id, tokens=int(verdict.get("tokens", 0) or 0))
            add_step(goal_id, idx, "verify", thought=final_answer[:1000],
                     action="finish", observation=verdict, ok=verdict["passed"])
            append_event(
                "verification.completed",
                {
                    "passed": verdict["passed"],
                    "reason": verdict.get("reason"),
                    "missing": verdict.get("missing") or [],
                },
                goal_id=goal_id,
                trace_id=goal.get("trace_id"),
                source="verifier",
            )
            if verdict["passed"]:
                final_status, final_result = "done", final_answer
                memory_mod.save(
                    content=f"Objetivo concluído: {goal['title']} → {final_answer[:300]}",
                    kind="episodic", category="goal", goal_id=goal_id, importance=6,
                )
                break
            # reprovado: devolve feedback e continua
            miss = "; ".join(verdict.get("missing") or [])
            transcript.append({"role": "user", "content":
                f"OBSERVAÇÃO: o verificador REPROVOU. Motivo: {verdict['reason']}. "
                f"Faltando: {miss or '—'}. Continue trabalhando até cumprir o critério."})
            update_goal(goal_id, status="running")
            continue

        # ----- tool ----------------------------------------------------------
        if action == "tool":
            tool_id = str(decision.get("tool_id") or decision.get("tool") or "").strip()
            tool_input = decision.get("input") if isinstance(decision.get("input"), dict) else {}
            if not tool_id:
                transcript.append({"role": "user", "content":
                    "OBSERVAÇÃO: action=tool exige 'tool_id'. Tente de novo."})
                add_step(goal_id, idx, "error", thought=thought, action="missing_tool_id", ok=False)
                continue
            # injeta contexto interno (não vai pro log/auditoria)
            tool_input = {**tool_input, "_goal_id": goal_id,
                          "_parent_goal_id": goal_id, "_depth": int(goal.get("depth", 0))}
            append_event(
                "tool.requested",
                {"tool": tool_id, "input_keys": sorted(k for k in tool_input.keys() if not k.startswith("_"))},
                goal_id=goal_id,
                trace_id=goal.get("trace_id"),
                source="agent",
            )
            t0 = time.time()
            result = await execute_tool(tool_id, tool_input, source="agent", trace_id=goal["trace_id"])
            elapsed = int((time.time() - t0) * 1000)
            tool_calls += 1
            bump_counters(goal_id, tool_calls=1)
            inner = result.get("result", result)
            ok = bool(result.get("ok", False))
            add_step(goal_id, idx, "act", thought=thought, action=tool_id,
                     tool_input={k: v for k, v in tool_input.items() if not k.startswith("_")},
                     observation=inner, ok=ok, elapsed_ms=elapsed)
            append_event(
                "tool.executed",
                {
                    "tool": tool_id,
                    "ok": ok,
                    "elapsed_ms": elapsed,
                    "status": result.get("status"),
                    "error": result.get("error"),
                },
                goal_id=goal_id,
                trace_id=goal.get("trace_id"),
                source="tool",
            )
            obs = json.dumps(inner, ensure_ascii=False, default=str)
            if len(obs) > 8000:
                obs = obs[:8000] + "…[truncado]"
            transcript.append({"role": "user", "content":
                f"OBSERVAÇÃO (tool={tool_id}, ok={ok}): {obs}"})
            continue

        # ----- ação desconhecida ---------------------------------------------
        add_step(goal_id, idx, "error", thought=thought, action=action or "unknown", ok=False)
        transcript.append({"role": "user", "content":
            "OBSERVAÇÃO: 'action' deve ser 'tool' ou 'finish'. Responda de novo."})

    # ----- finalização -------------------------------------------------------
    update_goal(
        goal_id, status=final_status, result=final_result,
        verifier=last_verifier, finished_at=__import__("db").now_iso(),
        error=None if final_status in ("done",) else final_result,
    )
    add_step(goal_id, idx + 1, "finish", action=final_status, observation=final_result,
             ok=final_status == "done")
    append_event(
        "goal.run_completed",
        {
            "status": final_status,
            "ok": final_status == "done",
            "iterations": idx,
            "tool_calls": tool_calls,
        },
        goal_id=goal_id,
        trace_id=goal.get("trace_id"),
        source="agent",
    )
    if final_status != "done":
        memory_mod.save(
            content=f"Objetivo {final_status}: {goal['title']} → {final_result[:300]}",
            kind="episodic", category="goal", goal_id=goal_id, importance=5,
        )
    return {"ok": final_status == "done", "status": final_status,
            "result": final_result, "verifier": last_verifier,
            "iterations": idx, "tool_calls": tool_calls}
