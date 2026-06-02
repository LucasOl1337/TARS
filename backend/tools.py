"""Ferramentas modulares do TARS.

O catálogo vem de ../ferramentas/*.json (uma ferramenta por arquivo). Cada
arquivo declara metadados + um bloco `invoke` que define COMO a ferramenta é
executada:

  - {"type": "builtin", "handler": "<nome>"}  → executor Python local (abaixo)
  - {"type": "bridge", "bridge": "yume", "method": "GET", "endpoint": "/api/..."}
        → repassa a chamada por uma ponte do hub
  - {} ou ausente                              → stub de catálogo (sem executor)

Isso espelha o padrão do Yume (catálogo JSON + invoke), mas com executores de
domínio espacial embutidos.
"""
from __future__ import annotations

import asyncio
import json
import math
import subprocess
import time
from datetime import datetime, timezone
from typing import Any

import httpx

import governance
import memory as memory_mod
from config import TOOLS_DIR


def _str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(v).strip() for v in value if str(v).strip()]


# Cache do catálogo: parsear os JSONs do disco a cada chamada é caro e o /chat
# chama isto ~5x por request. Cacheamos com invalidação por assinatura (nome +
# mtime + tamanho de cada arquivo) — relê só quando uma ferramenta muda no disco.
_catalog_cache: tuple[list[dict[str, Any]], list[dict[str, str]]] | None = None
_catalog_sig: tuple[tuple[str, int, int], ...] | None = None


def _catalog_signature() -> tuple[tuple[str, int, int], ...]:
    sig: list[tuple[str, int, int]] = []
    for path in sorted(TOOLS_DIR.glob("*.json")):
        try:
            st = path.stat()
            sig.append((path.name, st.st_mtime_ns, st.st_size))
        except OSError:
            continue
    return tuple(sig)


def load_tool_catalog() -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    global _catalog_cache, _catalog_sig
    TOOLS_DIR.mkdir(parents=True, exist_ok=True)
    sig = _catalog_signature()
    if _catalog_cache is not None and sig == _catalog_sig:
        return _catalog_cache

    tools: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for path in sorted(TOOLS_DIR.glob("*.json")):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            errors.append({"file": path.name, "error": str(exc)})
            continue
        tool_id = str(raw.get("id") or path.stem).strip()
        if not tool_id:
            errors.append({"file": path.name, "error": "missing id"})
            continue
        invoke = raw.get("invoke") if isinstance(raw.get("invoke"), dict) else {}
        tools.append({
            "id": tool_id,
            "name": str(raw.get("name") or tool_id).strip(),
            "description": str(raw.get("description") or "").strip(),
            "category": str(raw.get("category") or "geral").strip(),
            "kind": str(raw.get("kind") or "tool").strip(),
            "provider": str(raw.get("provider") or "tars").strip(),
            "capabilities": _str_list(raw.get("capabilities")),
            "tags": _str_list(raw.get("tags")),
            "prompt_instruction": str(raw.get("prompt_instruction") or "").strip(),
            "parameters": raw.get("parameters") if isinstance(raw.get("parameters"), dict) else {},
            "invoke": invoke,
        })
    tools.sort(key=lambda t: (t["category"], t["name"], t["id"]))
    _catalog_cache = (tools, errors)
    _catalog_sig = sig
    return _catalog_cache


def tools_by_id() -> dict[str, dict[str, Any]]:
    tools, _ = load_tool_catalog()
    return {t["id"]: t for t in tools}


# --------------------------------------------------------------------------- #
# Built-in executors (domínio: exploração espacial)                           #
# --------------------------------------------------------------------------- #

def _ok(**data: Any) -> dict[str, Any]:
    return {"ok": True, **data}


def _err(message: str, code: str = "VALIDATION") -> dict[str, Any]:
    return {"ok": False, "error": {"code": code, "message": message}}


def _bi_think(payload: dict[str, Any]) -> dict[str, Any]:
    """Espaço de raciocínio explícito — devolve o pensamento estruturado."""
    thought = str(payload.get("thought") or payload.get("text") or "").strip()
    if not thought:
        return _err("informe 'thought' com o raciocínio a registrar")
    return _ok(thought=thought, note="raciocínio registrado (não visível ao usuário final)")


def _bi_mission_log(payload: dict[str, Any]) -> dict[str, Any]:
    """Registra uma entrada no log de missão — AGORA persiste no SQLite."""
    entry = str(payload.get("entry") or "").strip()
    if not entry:
        return _err("informe 'entry' com o texto do log")
    res = memory_mod.log_mission(
        entry=entry,
        category=str(payload.get("category") or "geral"),
        goal_id=payload.get("_goal_id"),
    )
    if not res.get("ok"):
        return _err(res.get("error") or "falha ao gravar mission_log")
    return _ok(logged_at=datetime.now(timezone.utc).isoformat(), **res)


# Constantes orbitais (corpo central = Sol, salvo override).
_MU_SUN = 1.32712440018e20  # m^3/s^2
_MU = {
    "sun": 1.32712440018e20,
    "earth": 3.986004418e14,
    "mars": 4.282837e13,
    "moon": 4.9048695e12,
}
_AU = 1.495978707e11  # m


def _bi_orbital_calc(payload: dict[str, Any]) -> dict[str, Any]:
    """Cálculos orbitais básicos: período circular e delta-v de Hohmann.

    payload:
      op: "period" | "hohmann"
      body: "sun"|"earth"|"mars"|"moon" (corpo central; default sun)
      r_km / r1_km / r2_km: raios orbitais em km (período usa r_km;
        hohmann usa r1_km e r2_km)
    """
    op = str(payload.get("op") or "period").strip().lower()
    body = str(payload.get("body") or "sun").strip().lower()
    mu = _MU.get(body, _MU_SUN)
    try:
        if op == "period":
            r = float(payload["r_km"]) * 1000.0
            if r <= 0:
                return _err("r_km deve ser > 0")
            t = 2 * math.pi * math.sqrt(r ** 3 / mu)
            return _ok(
                op="period", body=body, r_km=r / 1000.0,
                period_s=t, period_h=t / 3600.0, period_days=t / 86400.0,
            )
        if op == "hohmann":
            r1 = float(payload["r1_km"]) * 1000.0
            r2 = float(payload["r2_km"]) * 1000.0
            if r1 <= 0 or r2 <= 0:
                return _err("r1_km e r2_km devem ser > 0")
            v1 = math.sqrt(mu / r1)
            v2 = math.sqrt(mu / r2)
            a_t = (r1 + r2) / 2
            vp = math.sqrt(mu * (2 / r1 - 1 / a_t))
            va = math.sqrt(mu * (2 / r2 - 1 / a_t))
            dv1 = abs(vp - v1)
            dv2 = abs(v2 - va)
            t_transfer = math.pi * math.sqrt(a_t ** 3 / mu)
            return _ok(
                op="hohmann", body=body,
                r1_km=r1 / 1000.0, r2_km=r2 / 1000.0,
                delta_v1_ms=dv1, delta_v2_ms=dv2, delta_v_total_ms=dv1 + dv2,
                transfer_time_s=t_transfer, transfer_time_days=t_transfer / 86400.0,
            )
        return _err(f"op desconhecida: '{op}' (use 'period' ou 'hohmann')")
    except KeyError as exc:
        return _err(f"campo obrigatório ausente: {exc}")
    except (TypeError, ValueError) as exc:
        return _err(f"valor numérico inválido: {exc}")


# Mini-catálogo de corpos do sistema solar (raio orbital médio + período).
_PLANETS = {
    "mercury": {"name": "Mercúrio", "a_au": 0.387, "period_days": 87.97, "moons": 0},
    "venus": {"name": "Vênus", "a_au": 0.723, "period_days": 224.70, "moons": 0},
    "earth": {"name": "Terra", "a_au": 1.000, "period_days": 365.26, "moons": 1},
    "mars": {"name": "Marte", "a_au": 1.524, "period_days": 686.98, "moons": 2},
    "jupiter": {"name": "Júpiter", "a_au": 5.203, "period_days": 4332.59, "moons": 95},
    "saturn": {"name": "Saturno", "a_au": 9.537, "period_days": 10759.22, "moons": 146},
    "uranus": {"name": "Urano", "a_au": 19.191, "period_days": 30688.5, "moons": 28},
    "neptune": {"name": "Netuno", "a_au": 30.069, "period_days": 60182.0, "moons": 16},
}


def _bi_astro_lookup(payload: dict[str, Any]) -> dict[str, Any]:
    """Consulta dados de um corpo do sistema solar (offline, determinístico)."""
    body = str(payload.get("body") or "").strip().lower()
    if not body:
        return _ok(bodies=list(_PLANETS.keys()), note="informe 'body' para detalhe")
    # aceita nomes em pt também
    alias = {
        "mercurio": "mercury", "mercúrio": "mercury", "venus": "venus",
        "vênus": "venus", "terra": "earth", "marte": "mars",
        "jupiter": "jupiter", "júpiter": "jupiter", "saturno": "saturn",
        "urano": "uranus", "netuno": "neptune",
    }
    key = alias.get(body, body)
    data = _PLANETS.get(key)
    if not data:
        return _err(f"corpo '{body}' não está no catálogo offline", code="NOT_FOUND")
    return _ok(
        body=key, name=data["name"], semimajor_axis_au=data["a_au"],
        semimajor_axis_km=data["a_au"] * _AU / 1000.0,
        orbital_period_days=data["period_days"], known_moons=data["moons"],
    )


# --------------------------------------------------------------------------- #
# Built-in executors (capacidades reais — com governança)                     #
# --------------------------------------------------------------------------- #

_OUTPUT_CAP = 16000


def _cap(text: str, limit: int = _OUTPUT_CAP) -> str:
    text = text or ""
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n…[truncado: {len(text)} chars]"


def _bi_shell_exec(payload: dict[str, Any]) -> dict[str, Any]:
    """Executa um comando de shell DENTRO do workspace, sob allowlist/denylist."""
    command = str(payload.get("command") or payload.get("cmd") or "").strip()
    if not command:
        return _err("informe 'command' com o comando a executar")

    verdict = governance.classify_command(command)
    if not verdict["allowed"]:
        return _err(f"comando bloqueado: {verdict['reason']}", code="BLOCKED")

    cwd = governance.workspace_root()
    if payload.get("cwd"):
        resolved = governance.resolve_in_sandbox(payload["cwd"])
        if resolved is None or not resolved.is_dir():
            return _err("cwd fora do sandbox ou inexistente", code="BLOCKED")
        cwd = resolved

    timeout = min(int(payload.get("timeout", 120)), 600)
    try:
        proc = subprocess.run(
            command, shell=True, cwd=str(cwd), capture_output=True,
            text=True, timeout=timeout, encoding="utf-8", errors="replace",
        )
    except subprocess.TimeoutExpired:
        return _err(f"comando excedeu o timeout de {timeout}s", code="TIMEOUT")
    except Exception as exc:  # noqa: BLE001
        return _err(f"falha ao executar: {exc}", code="EXEC_ERROR")

    return _ok(
        command=command, cwd=str(cwd), exit_code=proc.returncode,
        ok_exit=proc.returncode == 0,
        stdout=_cap(proc.stdout), stderr=_cap(proc.stderr),
        irreversible=verdict.get("irreversible", False),
    )


def _bi_fs_read(payload: dict[str, Any]) -> dict[str, Any]:
    path = str(payload.get("path") or "").strip()
    if not path:
        return _err("informe 'path'")
    resolved = governance.resolve_in_sandbox(path)
    if resolved is None:
        return _err("caminho fora do sandbox (workspace)", code="BLOCKED")
    if not resolved.is_file():
        return _err(f"arquivo não encontrado: {path}", code="NOT_FOUND")
    try:
        data = resolved.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:  # noqa: BLE001
        return _err(f"erro ao ler: {exc}", code="IO_ERROR")
    return _ok(path=str(resolved), size=len(data), content=_cap(data, 40000))


def _bi_fs_write(payload: dict[str, Any]) -> dict[str, Any]:
    path = str(payload.get("path") or "").strip()
    if not path:
        return _err("informe 'path'")
    content = payload.get("content")
    if content is None:
        return _err("informe 'content' (texto a gravar)")
    resolved = governance.resolve_in_sandbox(path)
    if resolved is None:
        return _err("caminho fora do sandbox (workspace)", code="BLOCKED")
    mode = "a" if str(payload.get("mode", "w")).lower() in ("a", "append") else "w"
    try:
        resolved.parent.mkdir(parents=True, exist_ok=True)
        with open(resolved, mode, encoding="utf-8") as fh:
            fh.write(str(content))
    except Exception as exc:  # noqa: BLE001
        return _err(f"erro ao gravar: {exc}", code="IO_ERROR")
    return _ok(path=str(resolved), bytes=len(str(content)), mode=mode)


def _bi_fs_list(payload: dict[str, Any]) -> dict[str, Any]:
    path = str(payload.get("path") or ".").strip() or "."
    resolved = governance.resolve_in_sandbox(path)
    if resolved is None:
        return _err("caminho fora do sandbox (workspace)", code="BLOCKED")
    if not resolved.exists():
        return _err(f"caminho não existe: {path}", code="NOT_FOUND")
    if resolved.is_file():
        return _ok(path=str(resolved), type="file", size=resolved.stat().st_size)
    entries = []
    try:
        for child in sorted(resolved.iterdir()):
            entries.append({
                "name": child.name,
                "type": "dir" if child.is_dir() else "file",
                "size": child.stat().st_size if child.is_file() else None,
            })
    except Exception as exc:  # noqa: BLE001
        return _err(f"erro ao listar: {exc}", code="IO_ERROR")
    return _ok(path=str(resolved), type="dir", count=len(entries), entries=entries[:500])


def _bi_web_fetch(payload: dict[str, Any]) -> dict[str, Any]:
    url = str(payload.get("url") or "").strip()
    if not url:
        return _err("informe 'url'")
    if not url.lower().startswith(("http://", "https://")):
        return _err("url deve começar com http:// ou https://", code="BLOCKED")
    try:
        with httpx.Client(timeout=30, follow_redirects=True,
                          headers={"User-Agent": "TARS/1.0 (+autonomous-agent)"}) as client:
            resp = client.get(url)
        ct = resp.headers.get("content-type", "")
        body = resp.text if ct.startswith(("text/", "application/json")) or "+json" in ct or "xml" in ct else f"[binário: {ct}, {len(resp.content)} bytes]"
        return _ok(url=str(resp.url), status=resp.status_code,
                   content_type=ct, content=_cap(body, 40000))
    except Exception as exc:  # noqa: BLE001
        return _err(f"falha ao buscar URL: {exc}", code="FETCH_ERROR")


def _bi_web_search(payload: dict[str, Any]) -> dict[str, Any]:
    """Busca web best-effort via DuckDuckGo HTML (sem API key). Frágil por
    design — se quebrar, plugue um provedor de busca como bridge."""
    import re
    from html import unescape
    from urllib.parse import unquote

    query = str(payload.get("query") or payload.get("q") or "").strip()
    if not query:
        return _err("informe 'query'")
    try:
        with httpx.Client(timeout=20, follow_redirects=True,
                          headers={"User-Agent": "Mozilla/5.0 (TARS)"}) as client:
            resp = client.post("https://html.duckduckgo.com/html/", data={"q": query})
        html = resp.text
        results = []
        for m in re.finditer(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html, re.S):
            href, title = m.group(1), re.sub(r"<[^>]+>", "", m.group(2))
            if "uddg=" in href:
                href = unquote(href.split("uddg=")[-1].split("&")[0])
            results.append({"title": unescape(title.strip()), "url": href})
            if len(results) >= int(payload.get("max_results", 8)):
                break
        return _ok(query=query, count=len(results), results=results,
                   note=None if results else "sem resultados parseáveis (HTML mudou?)")
    except Exception as exc:  # noqa: BLE001
        return _err(f"falha na busca: {exc}", code="SEARCH_ERROR")


def _bi_memory_save(payload: dict[str, Any]) -> dict[str, Any]:
    return memory_mod.save(
        content=str(payload.get("content") or ""),
        kind=str(payload.get("kind") or "episodic"),
        category=str(payload.get("category") or "geral"),
        tags=payload.get("tags"),
        goal_id=payload.get("_goal_id"),
        importance=int(payload.get("importance", 5) or 5),
        source=str(payload.get("source") or "agent"),
    )


def _bi_memory_recall(payload: dict[str, Any]) -> dict[str, Any]:
    return memory_mod.recall(
        query=str(payload.get("query") or ""),
        kind=str(payload.get("kind") or ""),
        limit=int(payload.get("limit", 8) or 8),
    )


# ----- Async builtins (precisam de await: LLM, pontes, sub-agentes) --------- #

async def _abi_llm_subcall(payload: dict[str, Any]) -> dict[str, Any]:
    """TARS chama um LLM para uma sub-tarefa (resumir, extrair, classificar...)."""
    from brain import dispatch_llm, provider_for_model
    import config as _config

    prompt = str(payload.get("prompt") or payload.get("input") or "").strip()
    if not prompt:
        return _err("informe 'prompt' com a tarefa para o sub-modelo")
    model = str(payload.get("model") or _config.TARS_MODEL)
    system = str(payload.get("system") or "Você é um sub-processo do TARS. Responda direto, sem floreio.")
    provider, send_model = provider_for_model(model)
    if not provider:
        return _err("nenhum provider LLM configurado", code="NO_PROVIDER")
    try:
        result = await dispatch_llm(
            provider, send_model, system,
            [{"role": "user", "content": prompt}],
            float(payload.get("temperature", 0.3)),
            int(payload.get("max_tokens", 2000)),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(f"falha no sub-modelo: {exc}", code="LLM_ERROR")
    return _ok(content=result.get("content", ""), model=result.get("model"),
               provider=result.get("provider"), usage=result.get("usage"))


async def _abi_kamui_call(payload: dict[str, Any]) -> dict[str, Any]:
    """Capacidade cross-dimensão: chama um endpoint via a ponte Kamui."""
    from bridges import call_bridge

    endpoint = str(payload.get("endpoint") or "/").strip()
    if not endpoint.startswith("/"):
        endpoint = "/" + endpoint
    method = str(payload.get("method", "GET")).upper()
    bridge = str(payload.get("bridge") or "kamui")
    body = payload.get("body") if isinstance(payload.get("body"), (dict, list)) else None
    envelope = await call_bridge(bridge, endpoint, method, body=body,
                                 raw_query=str(payload.get("query") or ""))
    return _ok(bridge=bridge, endpoint=endpoint, status=envelope.get("status"),
               bridge_ok=envelope.get("ok"), data=envelope.get("data"),
               error=envelope.get("error"))


async def _abi_spawn_subagent(payload: dict[str, Any]) -> dict[str, Any]:
    """Decompõe: cria um objetivo-filho e o executa (recursão limitada)."""
    import goals as goals_mod
    from agent import run_goal

    title = str(payload.get("title") or "").strip()
    if not title:
        return _err("informe 'title' do sub-objetivo")
    parent_depth = int(payload.get("_depth", 0) or 0)
    max_depth = governance.DEFAULT_BUDGET["max_subagent_depth"]
    if parent_depth >= max_depth:
        return _err(f"profundidade máxima de sub-agentes atingida ({max_depth})", code="DEPTH_LIMIT")

    child = goals_mod.create_goal(
        title=title,
        description=str(payload.get("description") or ""),
        definition_of_done=str(payload.get("definition_of_done") or ""),
        origin="subagent",
        parent_id=payload.get("_parent_goal_id"),
        depth=parent_depth + 1,
        budget={"max_iterations": int(payload.get("max_iterations", 8) or 8)},
    )
    outcome = await run_goal(child["id"])
    return _ok(subgoal_id=child["id"], status=outcome.get("status"),
               result=outcome.get("result"), verifier=outcome.get("verifier"))


def _bi_grok_imagine(payload: dict[str, Any]) -> dict[str, Any]:
    """Gera uma imagem via Grok Terminal (/imagine) e salva no destino (default: Desktop)."""
    import grok_imagine
    prompt = str(payload.get("prompt") or payload.get("description") or "").strip()
    if not prompt:
        return _err("informe 'prompt' com a descrição da imagem")
    return grok_imagine.generate(
        prompt=prompt,
        filename=payload.get("filename"),
        dest=payload.get("dest"),
        output_path=payload.get("output_path"),
        timeout=min(int(payload.get("timeout", 200) or 200), 480),
    )


BUILTIN_HANDLERS = {
    "think": _bi_think,
    "mission_log": _bi_mission_log,
    "grok_imagine": _bi_grok_imagine,
    "orbital_calc": _bi_orbital_calc,
    "astro_lookup": _bi_astro_lookup,
    "shell_exec": _bi_shell_exec,
    "fs_read": _bi_fs_read,
    "fs_write": _bi_fs_write,
    "fs_list": _bi_fs_list,
    "web_fetch": _bi_web_fetch,
    "web_search": _bi_web_search,
    "memory_save": _bi_memory_save,
    "memory_recall": _bi_memory_recall,
}

ASYNC_BUILTIN_HANDLERS = {
    "llm_subcall": _abi_llm_subcall,
    "kamui_call": _abi_kamui_call,
    "spawn_subagent": _abi_spawn_subagent,
}


def is_builtin(handler: str) -> bool:
    return handler in BUILTIN_HANDLERS or handler in ASYNC_BUILTIN_HANDLERS


def invoke_builtin(handler: str, payload: dict[str, Any] | None) -> dict[str, Any]:
    """Invoca um builtin SÍNCRONO. (handlers async devem ir por execute_tool.)"""
    fn = BUILTIN_HANDLERS.get(handler)
    if not fn:
        if handler in ASYNC_BUILTIN_HANDLERS:
            return _err(f"'{handler}' é async — use execute_tool", code="ASYNC_ONLY")
        return _err(f"handler builtin '{handler}' não existe", code="NOT_FOUND")
    try:
        return fn(payload or {})
    except Exception as exc:  # noqa: BLE001
        return _err(f"erro interno na ferramenta: {exc}", code="INTERNAL")


async def execute_tool(
    tool_id: str,
    data: dict[str, Any] | None,
    source: str = "tool",
    trace_id: str | None = None,
) -> dict[str, Any]:
    """Executor UNIFICADO de ferramentas (builtin sync/async + bridge).

    Não bloqueia o event loop: builtins síncronos rodam em threadpool. Toda
    execução é logada como echo (auditoria). Devolve um envelope normalizado:
        {tool, kind, ok, elapsed_ms, result, [bridge]}
    ou {ok:false, http_status, error} se a ferramenta não existir/for catálogo.
    """
    from bridges import call_bridge, log_echo

    catalog = tools_by_id()
    tool = catalog.get(tool_id)
    if not tool:
        return {"ok": False, "http_status": 404, "tool": tool_id,
                "error": {"code": "NOT_FOUND", "message": f"ferramenta '{tool_id}' não existe"}}

    payload = data if isinstance(data, dict) else {}
    invoke = tool.get("invoke") or {}
    kind = invoke.get("type")
    endpoint = f"/tools/{tool_id}/invoke"

    if kind == "builtin":
        handler = invoke.get("handler", "")
        started = time.time()
        if handler in ASYNC_BUILTIN_HANDLERS:
            try:
                result = await ASYNC_BUILTIN_HANDLERS[handler](payload)
            except Exception as exc:  # noqa: BLE001
                result = _err(f"erro interno na ferramenta async: {exc}", code="INTERNAL")
        else:
            result = await asyncio.to_thread(invoke_builtin, handler, payload)
        elapsed = int((time.time() - started) * 1000)
        ok = bool(result.get("ok", False))
        envelope = {"tool": tool_id, "kind": "builtin", "result": result,
                    "ok": ok, "elapsed_ms": elapsed}
        log_echo("tools",
                 {"ok": ok, "endpoint": endpoint, "status": 200 if ok else 422,
                  "data": envelope, "elapsed_ms": elapsed},
                 "POST", request_body={"input": _redact(payload)},
                 source=source, trace_id=trace_id)
        return envelope

    if kind == "bridge":
        bridge_id = invoke.get("bridge", "")
        method = str(invoke.get("method", "POST")).upper()
        bridge_endpoint = str(invoke.get("endpoint", "/"))
        envelope = await call_bridge(bridge_id, bridge_endpoint, method, body=payload)
        log_echo(bridge_id, envelope, method, request_body=_redact(payload),
                 source=source, trace_id=trace_id)
        return {"tool": tool_id, "kind": "bridge", "bridge": bridge_id,
                "result": envelope, "ok": bool(envelope.get("ok", False)),
                "elapsed_ms": envelope.get("elapsed_ms", 0)}

    return {"ok": False, "http_status": 422, "tool": tool_id,
            "error": {"code": "NOT_EXECUTABLE",
                      "message": f"ferramenta '{tool_id}' é só catálogo (sem invoke executável)"}}


def _redact(payload: dict[str, Any]) -> dict[str, Any]:
    """Remove chaves internas (prefixo _) do que vai pro log de auditoria."""
    return {k: v for k, v in payload.items() if not str(k).startswith("_")}
