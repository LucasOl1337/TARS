"""Heartbeat — o que faz o TARS estar "vivo".

Dois modos de vida convivem:
  - REATIVO: alguém cria um goal → ele é executado.
  - PROATIVO (este módulo): um tick periódico acorda o TARS para (a) avançar
    trabalho pendente e (b), quando ocioso, DECIDIR se vale propor um novo
    objetivo por conta própria.

Princípios de segurança (deliberados):
  - O heartbeat começa DESLIGADO. Ninguém age sozinho sem o operador ligar.
  - O juiz proativo só ENFILEIRA objetivos (pending) — quem executa é o loop,
    com toda a governança no caminho. Heartbeat não chama shell direto.
  - Serializado: no máximo um goal roda por vez (sem enxame acidental).
  - Em camadas: tick barato frequente; a chamada de LLM (cara) só dispara
    quando há sinal e respeitando um cooldown.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

import config
from brain import dispatch_llm, provider_for_model
from db import get_state, now_iso, set_state
from goals import create_goal, list_goals
from governance import kill_switch_engaged

# Chaves de estado (persistem entre reinícios).
K_ENABLED = "heartbeat.enabled"
K_AUTO_RUN = "heartbeat.auto_run"            # roda goals pendentes automaticamente
K_ALLOW_PROPOSALS = "heartbeat.allow_proposals"  # juiz pode criar novos goals
K_INTERVAL = "heartbeat.interval_s"
K_PROPOSAL_COOLDOWN = "heartbeat.proposal_cooldown_s"

_DEFAULTS = {
    K_ENABLED: False,
    K_AUTO_RUN: True,
    K_ALLOW_PROPOSALS: False,
    K_INTERVAL: 60,
    K_PROPOSAL_COOLDOWN: 600,
}

# Estado em memória (telemetria do loop).
_state: dict[str, Any] = {
    "beats": 0, "last_tick": None, "last_proposal_ts": 0,
    "running_goal": None, "last_action": None,
}
_busy = asyncio.Lock()


def _cfg(key: str) -> Any:
    return get_state(key, _DEFAULTS.get(key))


def status() -> dict[str, Any]:
    return {
        "enabled": bool(_cfg(K_ENABLED)),
        "auto_run": bool(_cfg(K_AUTO_RUN)),
        "allow_proposals": bool(_cfg(K_ALLOW_PROPOSALS)),
        "interval_s": int(_cfg(K_INTERVAL)),
        "proposal_cooldown_s": int(_cfg(K_PROPOSAL_COOLDOWN)),
        "kill_switch": kill_switch_engaged(),
        **_state,
    }


def configure(patch: dict[str, Any]) -> dict[str, Any]:
    mapping = {
        "enabled": K_ENABLED, "auto_run": K_AUTO_RUN,
        "allow_proposals": K_ALLOW_PROPOSALS, "interval_s": K_INTERVAL,
        "proposal_cooldown_s": K_PROPOSAL_COOLDOWN,
    }
    for friendly, key in mapping.items():
        if friendly in patch:
            val = patch[friendly]
            if key in (K_INTERVAL, K_PROPOSAL_COOLDOWN):
                val = max(10, int(val))
            else:
                val = bool(val)
            set_state(key, val)
    return status()


# --------------------------------------------------------------------------- #
# Juiz proativo — decide se vale criar um objetivo (e qual)                    #
# --------------------------------------------------------------------------- #

async def _propose_goal() -> dict[str, Any] | None:
    provider, send_model = provider_for_model(config.TARS_MODEL)
    if not provider:
        return None
    # contexto: objetivos recentes para não repetir
    recent = list_goals(limit=8)
    recent_titles = "; ".join(g["title"] for g in recent) or "(nenhum)"
    system = (
        "Você é o impulso proativo do TARS, uma IA autônoma. No tempo ocioso, "
        "decida se há um objetivo ÚTIL, seguro e concreto que valha a pena iniciar "
        "sozinho — ou se é melhor ficar quieto. Prefira ficar quieto a inventar "
        "tarefa fútil. Responda só com JSON: "
        '{"should_act": bool, "title": str, "description": str, '
        '"definition_of_done": str, "reason": str}'
    )
    user = (
        f"Objetivos recentes: {recent_titles}\n\n"
        "Há algo proativo, seguro e de valor a fazer agora? Se sim, defina um "
        "objetivo pequeno e verificável. Se não, should_act=false."
    )
    try:
        result = await dispatch_llm(provider, send_model, system,
                                    [{"role": "user", "content": user}], 0.5, 800)
    except Exception:
        return None
    import json
    raw = str(result.get("content") or "").strip()
    s, e = raw.find("{"), raw.rfind("}")
    if not (0 <= s < e):
        return None
    try:
        obj = json.loads(raw[s:e + 1])
    except Exception:
        return None
    if not obj.get("should_act") or not str(obj.get("title") or "").strip():
        return None
    return obj


# --------------------------------------------------------------------------- #
# Tick                                                                         #
# --------------------------------------------------------------------------- #

async def _tick() -> None:
    _state["beats"] += 1
    _state["last_tick"] = now_iso()

    if not _cfg(K_ENABLED) or kill_switch_engaged():
        _state["last_action"] = "idle (desligado)" if not _cfg(K_ENABLED) else "idle (kill-switch)"
        return
    if _busy.locked():
        _state["last_action"] = "ocupado (goal em execução)"
        return

    # (1) avançar trabalho pendente
    if _cfg(K_AUTO_RUN):
        pendings = list_goals(status="pending", limit=1)
        if pendings:
            await _run(pendings[0]["id"], reason="auto_run pending")
            return

    # (2) propor novo objetivo (quando ocioso, respeitando cooldown)
    if _cfg(K_ALLOW_PROPOSALS):
        running = list_goals(status="running", limit=1)
        pending = list_goals(status="pending", limit=1)
        cooldown = int(_cfg(K_PROPOSAL_COOLDOWN))
        idle_enough = (time.time() - float(_state.get("last_proposal_ts", 0))) > cooldown
        if not running and not pending and idle_enough:
            _state["last_proposal_ts"] = time.time()
            proposal = await _propose_goal()
            if proposal:
                goal = create_goal(
                    title=proposal["title"],
                    description=str(proposal.get("description") or ""),
                    definition_of_done=str(proposal.get("definition_of_done") or ""),
                    origin="heartbeat",
                )
                _state["last_action"] = f"propôs goal: {goal['title']}"
                # NÃO executa direto — só enfileira. auto_run pega no próximo tick.
                return
            _state["last_action"] = "juiz decidiu ficar quieto"
            return

    _state["last_action"] = "nada a fazer"


async def _run(goal_id: str, reason: str) -> None:
    from agent import run_goal  # lazy: evita ciclo no import
    async with _busy:
        _state["running_goal"] = goal_id
        _state["last_action"] = f"executando {goal_id} ({reason})"
        try:
            await run_goal(goal_id)
        except Exception as exc:  # noqa: BLE001
            _state["last_action"] = f"erro ao executar {goal_id}: {exc}"
        finally:
            _state["running_goal"] = None


# --------------------------------------------------------------------------- #
# Loop de fundo                                                                #
# --------------------------------------------------------------------------- #

async def run_forever() -> None:
    # garante defaults persistidos na primeira subida
    for key, val in _DEFAULTS.items():
        if get_state(key, None) is None:
            set_state(key, val)
    while True:
        try:
            await _tick()
        except Exception as exc:  # noqa: BLE001
            _state["last_action"] = f"tick falhou: {exc}"
        await asyncio.sleep(int(_cfg(K_INTERVAL)))
