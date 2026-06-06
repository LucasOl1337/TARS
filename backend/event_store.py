"""Event store imutável do runtime TARS.

Eventos são o log operacional transversal: heartbeat, goals, tools,
verificação, políticas e checkpoints. A regra é gravar fatos observáveis,
não hipóteses livres do modelo.
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any

from db import get_conn, now_iso


def append_event(
    event_type: str,
    payload: Any | None = None,
    *,
    heartbeat_id: str | None = None,
    goal_id: str | None = None,
    trace_id: str | None = None,
    source: str = "runtime",
) -> dict[str, Any]:
    event_type = str(event_type or "").strip()
    if not event_type:
        raise ValueError("event_type é obrigatório")

    if payload is None:
        payload = {}
    try:
        payload_json = json.dumps(payload, ensure_ascii=False, default=str)
    except Exception:
        payload_json = json.dumps({"value": str(payload)}, ensure_ascii=False)

    event = {
        "id": "evt_" + uuid.uuid4().hex,
        "type": event_type,
        "ts": int(time.time() * 1000),
        "timestamp": now_iso(),
        "heartbeat_id": heartbeat_id,
        "goal_id": goal_id,
        "trace_id": trace_id,
        "source": str(source or "runtime"),
        "payload_json": payload_json,
    }

    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO events (id, type, ts, timestamp, heartbeat_id, goal_id, trace_id, source, payload_json) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (
                event["id"],
                event["type"],
                event["ts"],
                event["timestamp"],
                event["heartbeat_id"],
                event["goal_id"],
                event["trace_id"],
                event["source"],
                event["payload_json"],
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return row_to_event(event)


def row_to_event(row: Any) -> dict[str, Any]:
    event = dict(row)
    raw = event.pop("payload_json", "{}")
    try:
        event["payload"] = json.loads(raw or "{}")
    except Exception:
        event["payload"] = {"raw": raw}
    return event


def list_events(
    *,
    limit: int = 100,
    event_type: str = "",
    goal_id: str = "",
    trace_id: str = "",
) -> list[dict[str, Any]]:
    limit = max(1, min(500, int(limit or 100)))
    where: list[str] = []
    params: list[Any] = []
    if event_type:
        where.append("type = ?")
        params.append(event_type)
    if goal_id:
        where.append("goal_id = ?")
        params.append(goal_id)
    if trace_id:
        where.append("trace_id = ?")
        params.append(trace_id)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    conn = get_conn()
    try:
        rows = conn.execute(
            f"SELECT * FROM events{clause} ORDER BY ts DESC LIMIT ?",
            (*params, limit),
        ).fetchall()
    finally:
        conn.close()
    return [row_to_event(row) for row in rows]


def event_summary() -> dict[str, Any]:
    conn = get_conn()
    try:
        total = conn.execute("SELECT count(*) AS c FROM events").fetchone()["c"]
        latest = conn.execute("SELECT max(ts) AS m FROM events").fetchone()["m"]
        by_type = conn.execute(
            "SELECT type, count(*) AS total FROM events GROUP BY type ORDER BY total DESC LIMIT 12"
        ).fetchall()
    finally:
        conn.close()
    return {
        "total": total,
        "latest_ts": latest,
        "by_type": [dict(row) for row in by_type],
    }
