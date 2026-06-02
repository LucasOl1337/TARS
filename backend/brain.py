"""Brain — a inteligência do TARS.

Duas responsabilidades:
  1) Compor o system prompt a partir dos blocos de comportamento da persona
     (identidade, propósito, tom, regras, ferramentas, exemplos...).
  2) Despachar a chamada de LLM para o provider resolvido (glm / kimi /
     anthropic / openrouter), igual ao Yume.
"""
from __future__ import annotations

import os
from typing import Any

import httpx

from config import (
    ANTHROPIC_API_KEY, ANTHROPIC_BASE,
    GLM_API_KEY, GLM_BASE,
    KIMI_API_KEY, KIMI_BASE,
    OPENROUTER_API_KEY, OPENROUTER_BASE,
)
from db import PROMPT_FLOW
from tools import tools_by_id


# --------------------------------------------------------------------------- #
# System prompt composition (comportamento)                                   #
# --------------------------------------------------------------------------- #

def _list_block(title: str, values: list[Any]) -> str:
    clean = [str(v).strip() for v in values if str(v).strip()]
    if not clean:
        return ""
    return f"## {title}\n\n" + "\n".join(f"- {v}" for v in clean)


def _tools_block(values: list[Any]) -> str:
    selected = [str(v).strip() for v in values if str(v).strip()]
    if not selected:
        return ""
    catalog = tools_by_id()
    rows = [
        "Ferramentas ativadas para o TARS. Elas são executadas pelo sistema fora do texto visível.",
        "Nunca escreva chamadas internas de ferramenta, identificadores ou payloads JSON na resposta ao usuário.",
        "Quando a pessoa pedir uma ação coberta por ferramenta, responda naturalmente e deixe o orquestrador executar.",
    ]
    for tool_id in selected:
        tool = catalog.get(tool_id)
        if not tool:
            rows.append(f"- `{tool_id}`")
            continue
        line = f"- `{tool_id}` — {tool.get('name') or tool_id}"
        if tool.get("description"):
            line += f": {tool['description']}"
        rows.append(line)
    return "## Ferramentas\n\n" + "\n".join(rows)


def _examples_block(examples: list[dict[str, Any]]) -> str:
    chunks: list[str] = []
    for idx, ex in enumerate(examples, start=1):
        user = str(ex.get("input") or "").strip()
        assistant = str(ex.get("output") or "").strip()
        if not user and not assistant:
            continue
        parts = [f"### Exemplo {idx}"]
        if user:
            parts.append(f"Usuário: {user}")
        if assistant:
            parts.append(f"Resposta: {assistant}")
        chunks.append("\n".join(parts))
    if not chunks:
        return ""
    return "## Few-shot\n\n" + "\n\n".join(chunks)


def _prompt_block(key: str, persona: dict[str, Any]) -> str:
    if key == "identity" and persona.get("identity"):
        return f"## Identidade\n\n{persona['identity']}"
    if key == "purpose" and persona.get("purpose"):
        return f"## Função\n\n{persona['purpose']}"
    if key == "tone" and persona.get("tone"):
        return f"## Tom\n\n{persona['tone']}"
    if key == "rules" and persona.get("rules"):
        return f"## Regras\n\n{persona['rules']}"
    if key == "fallbacks" and persona.get("fallbacks"):
        return f"## Fallbacks\n\n{persona['fallbacks']}"
    if key == "capabilities":
        return _list_block("Capacidades", persona.get("capabilities") or [])
    if key == "tools":
        return _tools_block(persona.get("tools") or [])
    if key == "channels":
        return _list_block("Canais", persona.get("channels") or [])
    if key == "examples":
        return _examples_block(persona.get("examples") or [])
    if key == "model":
        return (
            "## Modelo LLM\n\n"
            f"- Modelo: {persona.get('model') or ''}\n"
            f"- Temperatura: {persona.get('temperature')}\n"
            f"- Max tokens: {persona.get('max_tokens')}"
        )
    return ""


def _normalize_flow(persona: dict[str, Any]) -> list[str]:
    raw = persona.get("prompt_flow") or []
    flow = [str(x).strip().lower() for x in raw if str(x).strip().lower() in set(PROMPT_FLOW)]
    return flow or list(PROMPT_FLOW)


def build_system_prompt(persona: dict[str, Any]) -> str:
    sections = [
        block
        for key in _normalize_flow(persona)
        if (block := _prompt_block(key, persona))
    ]
    return (f"# {persona['name']}\n\n" + "\n\n".join(sections)).strip()


# --------------------------------------------------------------------------- #
# LLM dispatch                                                                 #
# --------------------------------------------------------------------------- #

def provider_for_model(model: str) -> tuple[str, str]:
    """Resolve (provider, model_name). Vazio se nenhuma key servir."""
    m = model.lower()
    if m.startswith("glm-") or m.startswith("glm/"):
        name = model.split("/", 1)[1] if "/" in model else model
        if GLM_API_KEY:
            return ("glm", name)
        if OPENROUTER_API_KEY:
            return ("openrouter", model)
        return ("", model)
    if m.startswith("kimi-") or m.startswith("moonshot-") or m.startswith("kimi/") or m.startswith("moonshot/"):
        name = model.split("/", 1)[1] if "/" in model else model
        if KIMI_API_KEY:
            return ("kimi", name)
        if OPENROUTER_API_KEY:
            return ("openrouter", model)
        return ("", model)
    if m.startswith("anthropic/"):
        if OPENROUTER_API_KEY:
            return ("openrouter", model)
        if ANTHROPIC_API_KEY:
            return ("anthropic", model.split("/", 1)[1])
        return ("", model)
    if OPENROUTER_API_KEY:
        return ("openrouter", model)
    if ANTHROPIC_API_KEY and "claude" in m:
        return ("anthropic", model)
    return ("", model)


def available_providers() -> dict[str, bool]:
    return {
        "glm": bool(GLM_API_KEY),
        "kimi": bool(KIMI_API_KEY),
        "anthropic": bool(ANTHROPIC_API_KEY),
        "openrouter": bool(OPENROUTER_API_KEY),
    }


async def _call_openai_compatible(
    base: str, api_key: str, provider: str, model: str,
    messages: list[dict[str, str]], temperature: float, max_tokens: int,
    extra_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(
            f"{base}/chat/completions",
            headers=headers,
            json={"model": model, "messages": messages,
                  "temperature": temperature, "max_tokens": max_tokens},
        )
    if resp.status_code != 200:
        raise RuntimeError(f"{provider} error {resp.status_code}: {resp.text[:500]}")
    data = resp.json()
    choice = data["choices"][0]["message"]
    return {"content": choice.get("content", ""), "model": data.get("model"),
            "usage": data.get("usage"), "provider": provider}


async def _call_anthropic(
    model: str, system: str, messages: list[dict[str, str]],
    temperature: float, max_tokens: int,
) -> dict[str, Any]:
    short = model.split("/", 1)[1] if "/" in model else model
    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(
            f"{ANTHROPIC_BASE}/messages",
            headers={"x-api-key": ANTHROPIC_API_KEY,
                     "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
            json={"model": short, "system": system, "messages": messages,
                  "temperature": temperature, "max_tokens": max_tokens},
        )
    if resp.status_code != 200:
        raise RuntimeError(f"anthropic error {resp.status_code}: {resp.text[:500]}")
    data = resp.json()
    blocks = data.get("content") or []
    text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
    return {"content": text, "model": data.get("model"),
            "usage": data.get("usage"), "provider": "anthropic"}


async def dispatch_llm(
    provider: str, send_model: str, system: str,
    messages: list[dict[str, str]], temperature: float, max_tokens: int,
) -> dict[str, Any]:
    if provider == "anthropic":
        return await _call_anthropic(send_model, system, messages, temperature, max_tokens)
    full = [{"role": "system", "content": system}] + messages
    if provider == "glm":
        return await _call_openai_compatible(GLM_BASE, GLM_API_KEY, "glm", send_model, full, temperature, max_tokens)
    if provider == "kimi":
        return await _call_openai_compatible(
            KIMI_BASE, KIMI_API_KEY, "kimi", send_model, full, temperature, max_tokens,
            extra_headers={"User-Agent": os.environ.get("KIMI_USER_AGENT", "claude-code/1.0")},
        )
    return await _call_openai_compatible(
        OPENROUTER_BASE, OPENROUTER_API_KEY, "openrouter", send_model, full, temperature, max_tokens,
        extra_headers={"HTTP-Referer": "http://127.0.0.1:62025", "X-Title": "TARS"},
    )
