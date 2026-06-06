from __future__ import annotations

from typing import Any

import httpx

import config
from brain import available_providers, build_system_prompt, dispatch_llm, provider_for_model
from bridges import latest_bridge_status
from db import get_conn, row_to_persona
from tools import execute_tool, load_tool_catalog

from .core import HarnessComponent, HarnessContext, HarnessRegistry


def _load_tars_persona() -> dict[str, Any] | None:
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM personas WHERE slug = ?", ("tars",)).fetchone()
    finally:
        conn.close()
    return row_to_persona(row) if row else None


async def check_health(_: HarnessContext) -> dict[str, Any]:
    persona = _load_tars_persona()
    tools, tool_errors = load_tool_catalog()
    providers = available_providers()
    return {
        "ok": bool(persona) and any(providers.values()) and not tool_errors,
        "persona_loaded": bool(persona),
        "tools_count": len(tools),
        "tool_errors": tool_errors,
        "providers": providers,
    }


async def check_persona(_: HarnessContext) -> dict[str, Any]:
    persona = _load_tars_persona()
    if not persona:
        return {"ok": False, "error": "persona tars not found"}
    required = ["name", "purpose", "identity", "tone", "rules"]
    missing = [field for field in required if not persona.get(field)]
    prompt = build_system_prompt(persona)
    return {
        "ok": not missing and len(prompt) > 100,
        "slug": persona.get("slug"),
        "name": persona.get("name"),
        "model": persona.get("model"),
        "missing_fields": missing,
        "prompt_length": len(prompt),
    }


async def check_providers(_: HarnessContext) -> dict[str, Any]:
    providers = available_providers()
    active_provider, active_model = provider_for_model(config.TARS_MODEL)
    ninerouter_provider, ninerouter_model = provider_for_model(f"ninerouter/{config.NINEROUTER_MODEL}")
    return {
        "ok": any(providers.values()) and bool(active_provider),
        "providers": providers,
        "active": {"provider": active_provider or None, "model": active_model},
        "ninerouter_default": {
            "provider": ninerouter_provider or None,
            "model": ninerouter_model,
            "base": config.NINEROUTER_BASE,
        },
    }


async def check_ninerouter_models(_: HarnessContext) -> dict[str, Any]:
    if not config.NINEROUTER_BASE:
        return {"ok": True, "status": "skipped", "reason": "NINEROUTER_BASE not configured"}

    headers = {"Authorization": f"Bearer {config.NINEROUTER_API_KEY}"}
    async with httpx.AsyncClient(timeout=8.0) as client:
        response = await client.get(f"{config.NINEROUTER_BASE}/models", headers=headers)
    data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
    models = data.get("data") if isinstance(data, dict) else []
    ids = [str(item.get("id")) for item in models if isinstance(item, dict) and item.get("id")]
    return {
        "ok": response.is_success and bool(ids),
        "status_code": response.status_code,
        "base": config.NINEROUTER_BASE,
        "model_count": len(ids),
        "sample_models": ids[:12],
        "default_model_present": config.NINEROUTER_MODEL in ids,
    }


async def check_tools(_: HarnessContext) -> dict[str, Any]:
    cases = [
        ("think", {"thought": "Harness component test"}),
        ("astro_lookup", {"body": "marte"}),
        ("orbital_calc", {"op": "period", "body": "earth", "r_km": 6678}),
    ]
    results = []
    for tool_id, payload in cases:
        result = await execute_tool(tool_id, payload, source="harness")
        results.append({
            "tool": tool_id,
            "ok": bool(result.get("ok")),
            "elapsed_ms": result.get("elapsed_ms", 0),
            "summary": str(result.get("result") or result.get("error"))[:240],
        })
    return {
        "ok": all(item["ok"] for item in results),
        "tests": results,
        "passed": sum(1 for item in results if item["ok"]),
        "total": len(results),
    }


async def check_bridges(_: HarnessContext) -> dict[str, Any]:
    rows = latest_bridge_status()
    known = [row for row in rows if row.get("ok") is not None]
    healthy = [row for row in rows if row.get("ok")]
    return {
        "ok": bool(known) and len(healthy) == len(rows),
        "total": len(rows),
        "known": len(known),
        "healthy": len(healthy),
        "bridges": [
            {
                "id": row.get("id"),
                "ok": row.get("ok"),
                "status": row.get("status"),
                "connection": row.get("connection"),
            }
            for row in rows
        ],
    }


async def check_chat_contract(_: HarnessContext) -> dict[str, Any]:
    persona = _load_tars_persona()
    if not persona:
        return {"ok": False, "error": "persona tars not found"}
    provider, model = provider_for_model(persona.get("model") or config.TARS_MODEL)
    messages = [{"role": "user", "content": "TARS, status?"}]
    return {
        "ok": bool(provider) and bool(messages[0]["content"]),
        "provider": provider or None,
        "model": model,
        "message_count": len(messages),
        "note": "Contract-only check; no LLM call.",
    }


async def check_ai_smoke(ctx: HarnessContext) -> dict[str, Any]:
    model = ctx.model or f"ninerouter/{config.NINEROUTER_MODEL}"
    provider, send_model = provider_for_model(model)
    if not provider:
        return {"ok": False, "error": f"no provider for model {model}"}
    result = await dispatch_llm(
        provider,
        send_model,
        "Voce e um verificador do TARS. Responda em uma frase curta.",
        [{"role": "user", "content": "Confirme que o motor de IA esta operacional."}],
        0.2,
        max(20, min(ctx.max_tokens, 160)),
    )
    content = str(result.get("content") or "").strip()
    return {
        "ok": 3 <= len(content) <= 500,
        "provider": result.get("provider", provider),
        "model": result.get("model", send_model),
        "response_preview": content[:200],
        "usage": result.get("usage"),
    }


def default_registry() -> HarnessRegistry:
    return HarnessRegistry([
        HarnessComponent(
            id="health",
            label="Health",
            description="Core backend, tools catalog, persona and provider readiness.",
            runner=check_health,
            tags=("core",),
        ),
        HarnessComponent(
            id="persona",
            label="Persona",
            description="Checks local TARS persona and generated system prompt.",
            runner=check_persona,
            tags=("core", "persona"),
        ),
        HarnessComponent(
            id="providers",
            label="Providers",
            description="Checks configured LLM providers and model resolution.",
            runner=check_providers,
            tags=("llm",),
        ),
        HarnessComponent(
            id="ninerouter-models",
            label="9Router Models",
            description="Checks the 9Router OpenAI-compatible models endpoint.",
            runner=check_ninerouter_models,
            tags=("llm", "ninerouter"),
        ),
        HarnessComponent(
            id="tools",
            label="Tools",
            description="Runs deterministic built-in tool checks.",
            runner=check_tools,
            tags=("tools",),
        ),
        HarnessComponent(
            id="bridges",
            label="Bridges",
            description="Checks latest bridge health snapshots.",
            runner=check_bridges,
            tags=("bridges",),
        ),
        HarnessComponent(
            id="chat-contract",
            label="Chat Contract",
            description="Validates chat input and model resolution without an LLM call.",
            runner=check_chat_contract,
            tags=("chat", "llm"),
        ),
        HarnessComponent(
            id="ai-smoke",
            label="AI Smoke",
            description="Runs a small real LLM call. Skipped unless live_ai is enabled.",
            runner=check_ai_smoke,
            tags=("llm", "live"),
            live_ai=True,
        ),
    ])
