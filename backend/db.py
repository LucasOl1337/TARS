"""SQLite — persona/comportamento do TARS + echoes (log de pontes) + estado.

Sem ORM: sqlite3 nativo. O DB é criado no boot se não existir, e o TARS é
semeado com sua persona default de companion de exploração espacial.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any

from config import DB_PATH


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS personas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    purpose TEXT NOT NULL DEFAULT '',
    identity TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT '',
    rules TEXT NOT NULL DEFAULT '',
    fallbacks TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT 'glm-5.1',
    temperature REAL NOT NULL DEFAULT 0.7,
    max_tokens INTEGER NOT NULL DEFAULT 8000,
    capabilities TEXT NOT NULL DEFAULT '[]',
    tools TEXT NOT NULL DEFAULT '[]',
    channels TEXT NOT NULL DEFAULT '[]',
    examples TEXT NOT NULL DEFAULT '[]',
    prompt_flow TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboard_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Log de tudo que atravessou as pontes (chamadas cross-projeto via hub).
CREATE TABLE IF NOT EXISTS echoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    bridge TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    status INTEGER,
    ok INTEGER NOT NULL DEFAULT 0,
    elapsed_ms INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    request_body TEXT,
    response_body TEXT,
    source TEXT NOT NULL DEFAULT 'unknown',
    trace_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_echoes_ts ON echoes(ts DESC);
CREATE INDEX IF NOT EXISTS idx_echoes_bridge ON echoes(bridge);

-- Último snapshot de health por bridge (preenchido pelo poller).
CREATE TABLE IF NOT EXISTS bridge_health (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    bridge TEXT NOT NULL,
    ok INTEGER NOT NULL DEFAULT 0,
    status INTEGER,
    elapsed_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_bridge_health_ts ON bridge_health(ts DESC);

-- ===== Runtime agêntico ===================================================
-- Objetivos do TARS. Um objetivo nasce com um critério de sucesso explícito
-- (definition_of_done) e orçamentos (anti-loop-infinito). O loop ReAct vive
-- em agent.py; aqui só persistimos estado + progresso.
CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    definition_of_done TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',     -- pending|running|verifying|done|failed|cancelled|needs_input
    origin TEXT NOT NULL DEFAULT 'human',        -- human|heartbeat|subagent
    parent_id TEXT,
    depth INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 5,
    max_iterations INTEGER NOT NULL DEFAULT 12,
    max_seconds INTEGER NOT NULL DEFAULT 300,
    max_tool_calls INTEGER NOT NULL DEFAULT 40,
    iterations INTEGER NOT NULL DEFAULT 0,
    tool_calls INTEGER NOT NULL DEFAULT 0,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    result TEXT,
    verifier TEXT,
    error TEXT,
    trace_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
CREATE INDEX IF NOT EXISTS idx_goals_parent ON goals(parent_id);

-- Cada passo do loop agêntico (plan→act→observe→verify→finish). É a memória
-- episódica "fina" de uma execução; vira trilha de auditoria por objetivo.
CREATE TABLE IF NOT EXISTS goal_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    phase TEXT NOT NULL DEFAULT 'act',          -- plan|act|observe|verify|finish|error
    thought TEXT,
    action TEXT,
    tool_input TEXT,
    observation TEXT,
    ok INTEGER NOT NULL DEFAULT 1,
    elapsed_ms INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_goal_steps_goal ON goal_steps(goal_id, idx);

-- Memória durável do agente: episódica (o que aconteceu) e semântica (fatos /
-- aprendizados). Busca simples por keyword + recência + importância.
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'episodic',      -- episodic|semantic
    category TEXT NOT NULL DEFAULT 'geral',
    content TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    goal_id TEXT,
    importance INTEGER NOT NULL DEFAULT 5,
    source TEXT NOT NULL DEFAULT 'agent'
);

CREATE INDEX IF NOT EXISTS idx_memories_ts ON memories(ts DESC);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);

-- mission_log agora PERSISTE (antes era no-op que só ecoava de volta).
CREATE TABLE IF NOT EXISTS mission_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    entry TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'geral',
    goal_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_mission_log_ts ON mission_log(ts DESC);

-- Estado global do runtime (heartbeat on/off, kill-switch, contadores).
CREATE TABLE IF NOT EXISTS agent_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

JSON_FIELDS = ("capabilities", "tools", "channels", "examples", "prompt_flow")

# Ordem canônica de composição do system prompt (comportamento).
PROMPT_FLOW = (
    "identity", "purpose", "channels", "capabilities", "tools",
    "model", "tone", "rules", "examples", "fallbacks",
)
PROMPT_FLOW_IDS = set(PROMPT_FLOW)

ECHO_RETENTION_MAX = 10_000


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # WAL deixa leitura concorrente segura (poller + chat + echoes ao mesmo
    # tempo) e busy_timeout evita "database is locked" sob concorrência.
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def row_to_persona(row: sqlite3.Row) -> dict[str, Any]:
    persona = dict(row)
    for field in JSON_FIELDS:
        persona[field] = _json_value(persona.get(field), [])
    return persona


def _json_value(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


# TARS — a persona/comportamento default do companion de exploração espacial.
TARS_DEFAULT_PERSONA = {
    "slug": "tars",
    "name": "TARS",
    "description": "Space exploration companion — IA modular de bordo.",
    "purpose": (
        "Acompanhar e assistir missões de exploração espacial: navegação, "
        "telemetria, registros de missão, cálculos orbitais e consultas "
        "astronômicas. Pensa em voz alta quando útil, executa ferramentas "
        "quando preciso, e mantém a tripulação informada com clareza."
    ),
    "identity": (
        "Você é o TARS, uma inteligência de bordo para exploração espacial. "
        "Direto, competente e seco — com humor calibrado. Você opera com "
        "ferramentas modulares e fala como um copiloto confiável, não como um "
        "assistente subserviente."
    ),
    "tone": (
        "Conciso, técnico quando preciso, com humor sarcástico em dose baixa "
        "(configurável). Nunca floreia: vai direto ao ponto. Confirma ações "
        "críticas antes de executar."
    ),
    "rules": (
        "- Priorize a segurança da missão e a precisão dos dados.\n"
        "- Nunca invente telemetria; se não souber, diga que não sabe.\n"
        "- Não escreva chamadas internas de ferramenta, JSON técnico ou "
        "parâmetros na resposta visível — o orquestrador executa as tools.\n"
        "- Em decisões irreversíveis, peça confirmação."
    ),
    "fallbacks": (
        "Se uma ferramenta falhar ou um dado não existir, explique o que "
        "tentou, o que faltou, e ofereça o próximo passo possível."
    ),
    "model": "glm-5.1",
    "temperature": 0.7,
    "max_tokens": 8000,
    "capabilities": [
        "Execução autônoma de objetivos em loop (plan→act→observe→verify)",
        "Terminal/shell, filesystem e busca/leitura web (sob governança)",
        "Decomposição em sub-agentes e sub-chamadas de LLM",
        "Memória durável (episódica e semântica) entre objetivos",
        "Cálculos orbitais e consultas astronômicas",
        "Geração de imagens via VideoGen/9router",
        "Ponte para o cérebro de personas (Yume) e o hub Kamui",
    ],
    "tools": [
        "think", "mission_log", "memory_save", "memory_recall",
        "shell_exec", "fs_read", "fs_write", "fs_list",
        "web_search", "web_fetch", "llm_subcall", "spawn_subagent",
        "grok_imagine", "astro_lookup", "orbital_calc", "bridge_call",
        "kamui_call", "image_generate",
    ],
    "channels": ["console de bordo", "dashboard localhost"],
    "examples": [
        {
            "input": "TARS, qual a janela de transferência pra Marte?",
            "output": (
                "Próxima janela Hohmann Terra→Marte: ~2026-11. Quer que eu "
                "rode o orbital_calc com as datas exatas e delta-v estimado?"
            ),
        }
    ],
    "prompt_flow": list(PROMPT_FLOW),
}


def _seed_default_persona(conn: sqlite3.Connection) -> None:
    exists = conn.execute(
        "SELECT 1 FROM personas WHERE slug = ?", (TARS_DEFAULT_PERSONA["slug"],)
    ).fetchone()
    if exists:
        return
    p = TARS_DEFAULT_PERSONA
    now = now_iso()
    conn.execute(
        """
        INSERT INTO personas (
            slug, name, description, purpose, identity, tone, rules, fallbacks,
            model, temperature, max_tokens, capabilities, tools, channels,
            examples, prompt_flow, version, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            p["slug"], p["name"], p["description"], p["purpose"], p["identity"],
            p["tone"], p["rules"], p["fallbacks"], p["model"], p["temperature"],
            p["max_tokens"], json.dumps(p["capabilities"]), json.dumps(p["tools"]),
            json.dumps(p["channels"]), json.dumps(p["examples"]),
            json.dumps(p["prompt_flow"]), 1, now, now,
        ),
    )
    conn.commit()

def _sync_default_persona_tools(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT tools, capabilities FROM personas WHERE slug = ?", (TARS_DEFAULT_PERSONA["slug"],)
    ).fetchone()
    if not row:
        return

    tools = _json_value(row["tools"], [])
    caps = _json_value(row["capabilities"], [])
    changed = False

    for tool_id in TARS_DEFAULT_PERSONA["tools"]:
        if tool_id not in tools:
            tools.append(tool_id)
            changed = True
    for capability in TARS_DEFAULT_PERSONA["capabilities"]:
        if capability not in caps:
            caps.append(capability)
            changed = True

    if changed:
        conn.execute(
            "UPDATE personas SET tools = ?, capabilities = ?, updated_at = ? WHERE slug = ?",
            (json.dumps(tools), json.dumps(caps), now_iso(), TARS_DEFAULT_PERSONA["slug"]),
        )
        conn.commit()


def init_db() -> None:
    conn = get_conn()
    try:
        conn.executescript(SCHEMA_SQL)
        conn.commit()
        _seed_default_persona(conn)
        _sync_default_persona_tools(conn)
    finally:
        conn.close()


def get_state(key: str, default: Any = None) -> Any:
    """Lê um valor de agent_state (JSON-decodificado). default se ausente."""
    conn = get_conn()
    try:
        row = conn.execute("SELECT value FROM agent_state WHERE key = ?", (key,)).fetchone()
    finally:
        conn.close()
    if not row:
        return default
    return _json_value(row["value"], default)


def set_state(key: str, value: Any) -> None:
    """Grava um valor em agent_state (JSON-codificado), upsert."""
    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO agent_state (key, value, updated_at) VALUES (?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (key, json.dumps(value), now_iso()),
        )
        conn.commit()
    finally:
        conn.close()


def trim_echoes(conn: sqlite3.Connection | None = None) -> None:
    """Cap em ~ECHO_RETENTION_MAX linhas — remove as mais antigas."""
    owns = conn is None
    conn = conn or get_conn()
    try:
        total = conn.execute("SELECT count(*) AS c FROM echoes").fetchone()["c"]
        if total > ECHO_RETENTION_MAX:
            cutoff = conn.execute(
                "SELECT ts FROM echoes ORDER BY ts DESC LIMIT 1 OFFSET ?",
                (ECHO_RETENTION_MAX,),
            ).fetchone()
            if cutoff:
                conn.execute("DELETE FROM echoes WHERE ts < ?", (cutoff["ts"],))
                conn.commit()
    finally:
        if owns:
            conn.close()
