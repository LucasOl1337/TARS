"""Modelo de objetivo (goal) — persistência + CRUD.

Um goal é a unidade de trabalho autônomo do TARS. Ele carrega o critério de
sucesso (definition_of_done) e os orçamentos que impedem loop infinito. O loop
de execução vive em agent.py; aqui só o estado.
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any

from db import get_conn, now_iso
from governance import DEFAULT_BUDGET

STATUSES = ("pending", "running", "verifying", "done", "failed", "cancelled", "needs_input")

_GOAL_COLUMNS = (
    "id", "title", "description", "definition_of_done", "status", "origin",
    "parent_id", "depth", "priority", "max_iterations", "max_seconds",
    "max_tool_calls", "iterations", "tool_calls", "tokens_used", "result",
    "verifier", "error", "trace_id", "created_at", "updated_at",
    "started_at", "finished_at",
)


def _row_to_goal(row: Any) -> dict[str, Any]:
    g = dict(row)
    if g.get("verifier"):
        try:
            g["verifier"] = json.loads(g["verifier"])
        except Exception:
            pass
    return g


def create_goal(
    title: str,
    description: str = "",
    definition_of_done: str = "",
    origin: str = "human",
    parent_id: str | None = None,
    depth: int = 0,
    priority: int = 5,
    budget: dict[str, Any] | None = None,
) -> dict[str, Any]:
    title = str(title or "").strip()
    if not title:
        raise ValueError("title é obrigatório")
    budget = budget or {}
    goal_id = uuid.uuid4().hex
    now = now_iso()
    record = {
        "id": goal_id,
        "title": title,
        "description": str(description or ""),
        "definition_of_done": str(definition_of_done or "").strip(),
        "status": "pending",
        "origin": origin if origin in ("human", "heartbeat", "subagent", "service") else "human",
        "parent_id": parent_id,
        "depth": int(depth or 0),
        "priority": int(priority or 5),
        "max_iterations": int(budget.get("max_iterations", DEFAULT_BUDGET["max_iterations"])),
        "max_seconds": int(budget.get("max_seconds", DEFAULT_BUDGET["max_seconds"])),
        "max_tool_calls": int(budget.get("max_tool_calls", DEFAULT_BUDGET["max_tool_calls"])),
        "iterations": 0, "tool_calls": 0, "tokens_used": 0,
        "result": None, "verifier": None, "error": None,
        "trace_id": goal_id, "created_at": now, "updated_at": now,
        "started_at": None, "finished_at": None,
    }
    conn = get_conn()
    try:
        conn.execute(
            f"INSERT INTO goals ({', '.join(_GOAL_COLUMNS)}) "
            f"VALUES ({', '.join(['?'] * len(_GOAL_COLUMNS))})",
            tuple(record[c] for c in _GOAL_COLUMNS),
        )
        conn.commit()
    finally:
        conn.close()
    return record


def get_goal(goal_id: str) -> dict[str, Any] | None:
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
    finally:
        conn.close()
    return _row_to_goal(row) if row else None


def list_goals(status: str = "", limit: int = 100) -> list[dict[str, Any]]:
    limit = max(1, min(500, int(limit or 100)))
    where, params = ("WHERE status = ?", [status]) if status else ("", [])
    params.append(limit)
    conn = get_conn()
    try:
        rows = conn.execute(
            f"SELECT * FROM goals {where} ORDER BY "
            f"CASE status WHEN 'running' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, "
            f"priority ASC, created_at DESC LIMIT ?",
            params,
        ).fetchall()
    finally:
        conn.close()
    return [_row_to_goal(r) for r in rows]


def update_goal(goal_id: str, **fields: Any) -> None:
    if not fields:
        return
    if "verifier" in fields and not isinstance(fields["verifier"], (str, type(None))):
        fields["verifier"] = json.dumps(fields["verifier"])
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values())
    conn = get_conn()
    try:
        conn.execute(
            f"UPDATE goals SET {sets}, updated_at = ? WHERE id = ?",
            (*vals, now_iso(), goal_id),
        )
        conn.commit()
    finally:
        conn.close()


def bump_counters(goal_id: str, iterations: int = 0, tool_calls: int = 0, tokens: int = 0) -> None:
    conn = get_conn()
    try:
        conn.execute(
            "UPDATE goals SET iterations = iterations + ?, tool_calls = tool_calls + ?, "
            "tokens_used = tokens_used + ?, updated_at = ? WHERE id = ?",
            (iterations, tool_calls, tokens, now_iso(), goal_id),
        )
        conn.commit()
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
# Passos do loop (trilha de execução)                                          #
# --------------------------------------------------------------------------- #

def add_step(
    goal_id: str,
    idx: int,
    phase: str,
    thought: str = "",
    action: str = "",
    tool_input: Any = None,
    observation: Any = None,
    ok: bool = True,
    elapsed_ms: int = 0,
) -> None:
    def _ser(v: Any) -> str | None:
        if v is None:
            return None
        if isinstance(v, str):
            return v[:12000]
        try:
            return json.dumps(v, ensure_ascii=False, default=str)[:12000]
        except Exception:
            return str(v)[:12000]

    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO goal_steps (goal_id, idx, ts, phase, thought, action, "
            "tool_input, observation, ok, elapsed_ms) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (goal_id, idx, int(time.time() * 1000), phase, _ser(thought) or "",
             action, _ser(tool_input), _ser(observation), 1 if ok else 0, elapsed_ms),
        )
        conn.commit()
    finally:
        conn.close()


def get_steps(goal_id: str, limit: int = 500) -> list[dict[str, Any]]:
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM goal_steps WHERE goal_id = ? ORDER BY idx ASC LIMIT ?",
            (goal_id, int(limit)),
        ).fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        d = dict(r)
        for f in ("tool_input", "observation"):
            if d.get(f):
                try:
                    d[f] = json.loads(d[f])
                except Exception:
                    pass
        out.append(d)
    return out
