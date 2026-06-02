"""Catálogo de endpoints — source of truth consumida pela página Endpoints do
dashboard. Descreve o que o próprio TARS oferece (inteligência + tools) e o que
cada ponte (bridge) expõe, no shape que o frontend espera:

  { modules: [ { id, label, desc, icon, featured?, outbound[], inbound[] } ] }

`outbound` = o que o módulo OFERECE (GET, leitura).
`inbound`  = o que o módulo ACEITA receber (POST/PUT/DELETE, escrita).
"""
from __future__ import annotations

from typing import Any

from tools import load_tool_catalog


def _ep(eid: str, method: str, path: str, summary: str, example: str | None = None) -> dict[str, Any]:
    d = {"id": eid, "method": method, "path": path, "summary": summary}
    if example:
        d["examplePayload"] = example
    return d


def build_catalog() -> list[dict[str, Any]]:
    tools, _ = load_tool_catalog()
    tool_count = len(tools)

    intelligence_out = [
        _ep("tars-health", "GET", "/api/tars/health", "health do hub + inteligência"),
        _ep("tars-persona", "GET", "/api/tars/persona", "persona/comportamento ativo do TARS"),
        _ep("tars-system-prompt", "GET", "/api/tars/system-prompt", "system prompt composto"),
        _ep("tars-providers", "GET", "/api/tars/chat/providers", "providers LLM disponíveis"),
    ]
    intelligence_in = [
        _ep("tars-chat", "POST", "/api/tars/chat", "conversa com o TARS (invoca LLM)",
            '{\n  "messages": [{"role": "user", "content": "olá TARS"}]\n}'),
        _ep("tars-persona-update", "PUT", "/api/tars/persona", "atualiza o comportamento do TARS",
            '{\n  "tone": "mais sarcástico",\n  "temperature": 0.9\n}'),
    ]

    # Agente — a superfície de SERVIÇO do TARS: outros serviços delegam trabalho.
    agent_out = [
        _ep("tars-goals", "GET", "/api/tars/goals", "lista de missões/trabalhos (status)"),
        _ep("tars-goal", "GET", "/api/tars/goals/{id}", "detalhe de uma missão"),
        _ep("tars-goal-steps", "GET", "/api/tars/goals/{id}/steps", "trail de execução (raciocínio→ferramenta→observação)"),
        _ep("tars-work-status", "GET", "/api/tars/work/{job_id}", "status/resultado de um trabalho delegado"),
        _ep("tars-heartbeat", "GET", "/api/tars/heartbeat", "estado da vida proativa (heartbeat)"),
    ]
    agent_in = [
        _ep("tars-work", "POST", "/api/tars/work", "OUTRO SERVIÇO delega um trabalho ao TARS (entrega autônoma + callback)",
            '{\n  "task": "gere uma imagem de um leão e salve no Desktop",\n  "definition_of_done": "arquivo de imagem existe no Desktop",\n  "callback_url": "http://meu-servico/done"\n}'),
        _ep("tars-goal-create", "POST", "/api/tars/goals", "cria + executa uma missão",
            '{\n  "title": "...",\n  "definition_of_done": "...",\n  "run": true\n}'),
        _ep("tars-goal-start", "POST", "/api/tars/goals/{id}/start", "dispara execução em background (assíncrono)"),
        _ep("tars-goal-cancel", "POST", "/api/tars/goals/{id}/cancel", "cancela uma missão"),
        _ep("tars-heartbeat-set", "PUT", "/api/tars/heartbeat", "liga/desliga e configura o heartbeat",
            '{\n  "enabled": true,\n  "auto_run": true\n}'),
        _ep("tars-kill", "POST", "/api/tars/kill-switch", "parada de emergência (kill-switch)",
            '{\n  "engage": true\n}'),
    ]

    tools_out = [_ep("tars-tools", "GET", "/api/tars/tools", f"catálogo modular ({tool_count} ferramentas)")]
    tools_in = [
        _ep("tars-tool-invoke", "POST", "/api/tars/tools/{tool_id}/invoke", "executa uma ferramenta modular",
            '{\n  "input": { "op": "hohmann", "r1_km": 6678, "r2_km": 42164 }\n}'),
    ]

    bridges_out = [
        _ep("tars-bridges", "GET", "/api/tars/bridges", "lista as pontes registradas"),
        _ep("tars-bridges-status", "GET", "/api/tars/bridges/status", "health das pontes (polling)"),
        _ep("tars-echoes", "GET", "/api/tars/echoes", "log de tudo que atravessou as pontes"),
    ]
    bridges_in = [
        _ep("tars-bridge-proxy", "POST", "/api/tars/bridge/{bridge_id}/{path}",
            "repassa uma chamada por uma ponte (proxy genérico)"),
    ]

    yume_out = [
        _ep("yume-health", "GET", "/api/tars/bridge/yume/api/health", "health do Yume (cérebro de personas)"),
        _ep("yume-personas", "GET", "/api/tars/bridge/yume/api/personas", "lista personas do Yume"),
        _ep("yume-tools", "GET", "/api/tars/bridge/yume/api/tools", "catálogo de tools do Yume"),
    ]
    yume_in = [
        _ep("yume-chat", "POST", "/api/tars/bridge/yume/api/chat", "conversa com uma persona do Yume",
            '{\n  "persona_slug": "tars",\n  "messages": [{"role":"user","content":"oi"}]\n}'),
    ]

    kamui_out = [
        _ep("kamui-health", "GET", "/api/tars/bridge/kamui/kamui/health", "health do hub Kamui"),
        _ep("kamui-tethers", "GET", "/api/tars/bridge/kamui/kamui/tethers", "tethers do Kamui"),
        _ep("kamui-endpoints", "GET", "/api/tars/bridge/kamui/kamui/endpoints", "catálogo do Kamui"),
    ]

    videogen_out = [
        _ep("videogen-health", "GET", "/api/tars/bridge/videogen/api/health", "health do VideoGen"),
        _ep("videogen-images-options", "GET", "/api/tars/bridge/videogen/api/images/options", "opções do motor de imagem"),
    ]
    videogen_in = [
        _ep("videogen-image-generate", "POST", "/api/tars/bridge/videogen/api/images/generate", "gera uma imagem via VideoGen/9router",
            '{\n  "backend": "gpt-direct",\n  "prompt": "base em Marte, iluminação cinematográfica",\n  "size": "1536x1024",\n  "model": "cx/gpt-5.5-image",\n  "quality": "auto",\n  "outputFormat": "png",\n  "force": true\n}'),
    ]

    return [
        {
            "id": "intelligence",
            "label": "Inteligência",
            "desc": "o cérebro do TARS — chat, persona e comportamento",
            "icon": "brain",
            "featured": True,
            "outbound": intelligence_out,
            "inbound": intelligence_in,
        },
        {
            "id": "agent",
            "label": "Agente",
            "desc": "superfície de serviço — outros serviços delegam trabalho ao TARS",
            "icon": "target",
            "featured": True,
            "outbound": agent_out,
            "inbound": agent_in,
        },
        {
            "id": "tools",
            "label": "Ferramentas",
            "desc": "catálogo modular de tools de exploração espacial",
            "icon": "boxes",
            "outbound": tools_out,
            "inbound": tools_in,
        },
        {
            "id": "bridges",
            "label": "Pontes",
            "desc": "hub — proxy + echoes + health das pontes",
            "icon": "cable",
            "outbound": bridges_out,
            "inbound": bridges_in,
        },
        {
            "id": "yume",
            "label": "Yume",
            "desc": "ponte para o cérebro de personas/comportamento",
            "icon": "user-circle-2",
            "outbound": yume_out,
            "inbound": yume_in,
        },
        {
            "id": "kamui",
            "label": "Kamui",
            "desc": "ponte para o hub de inteligência cross-dimensional",
            "icon": "route",
            "outbound": kamui_out,
            "inbound": [],
        },
        {
            "id": "videogen",
            "label": "VideoGen",
            "desc": "ponte para geração de imagens e pipeline audiovisual",
            "icon": "image",
            "outbound": videogen_out,
            "inbound": videogen_in,
        },
    ]
