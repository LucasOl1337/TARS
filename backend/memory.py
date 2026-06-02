"""Memória durável do TARS.

Três camadas conceituais:
  - working memory  → contexto do objetivo atual (vive no goal_steps, em agent.py)
  - episódica       → o que aconteceu ("rodei os testes e 3 falharam")
  - semântica       → fatos/aprendizados duráveis ("o projeto X usa pnpm, não npm")

Aqui ficam a episódica e a semântica (tabela `memories`) + o mission_log real.
A busca é simples de propósito: keyword (LIKE) combinada com recência e
importância. Quando precisar de busca vetorial, dá pra plugar o MCP de memória
do ambiente por trás de recall() sem mudar os chamadores.
"""
from __future__ import annotations

import json
import time
from typing import Any

from db import get_conn


def _tags(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str) and value.strip():
        return [t.strip() for t in value.split(",") if t.strip()]
    return []


def save(
    content: str,
    kind: str = "episodic",
    category: str = "geral",
    tags: Any = None,
    goal_id: str | None = None,
    importance: int = 5,
    source: str = "agent",
) -> dict[str, Any]:
    content = str(content or "").strip()
    if not content:
        return {"ok": False, "error": "conteúdo vazio"}
    kind = kind if kind in ("episodic", "semantic") else "episodic"
    importance = max(1, min(10, int(importance or 5)))
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO memories (ts, kind, category, content, tags, goal_id, importance, source) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (int(time.time() * 1000), kind, str(category or "geral"), content,
             json.dumps(_tags(tags)), goal_id, importance, source),
        )
        conn.commit()
        mem_id = cur.lastrowid
    finally:
        conn.close()
    return {"ok": True, "id": mem_id, "kind": kind, "category": category,
            "importance": importance, "stored": content[:160]}


def recall(query: str = "", kind: str = "", limit: int = 8) -> dict[str, Any]:
    """Busca por keyword + recência + importância. Sem query, devolve as mais
    recentes/importantes (útil pra hidratar o contexto do agente)."""
    limit = max(1, min(50, int(limit or 8)))
    where: list[str] = []
    params: list[Any] = []
    if kind in ("episodic", "semantic"):
        where.append("kind = ?")
        params.append(kind)
    q = str(query or "").strip()
    if q:
        # cada termo precisa aparecer em content OU category OU tags
        for term in [t for t in q.split() if t][:6]:
            where.append("(content LIKE ? OR category LIKE ? OR tags LIKE ?)")
            like = f"%{term}%"
            params.extend([like, like, like])
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    # ranqueia por importância e recência (peso simples e determinístico)
    sql = (
        f"SELECT id, ts, kind, category, content, tags, goal_id, importance, source "
        f"FROM memories{clause} "
        f"ORDER BY importance DESC, ts DESC LIMIT ?"
    )
    params.append(limit)
    conn = get_conn()
    try:
        rows = conn.execute(sql, params).fetchall()
    finally:
        conn.close()
    items = []
    for r in rows:
        d = dict(r)
        try:
            d["tags"] = json.loads(d.get("tags") or "[]")
        except Exception:
            d["tags"] = []
        items.append(d)
    return {"ok": True, "count": len(items), "items": items, "query": q or None}


def context_block(query: str = "", limit: int = 6) -> str:
    """Renderiza memórias relevantes como texto pro system prompt do agente.
    Vazio se não houver nada — não polui o contexto à toa."""
    res = recall(query=query, limit=limit)
    items = res.get("items") or []
    if not items:
        return ""
    lines = ["## Memória relevante"]
    for it in items:
        tag = f" [{', '.join(it['tags'])}]" if it.get("tags") else ""
        lines.append(f"- ({it['kind']}/{it['category']}{tag}) {it['content']}")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# mission_log — agora persiste de verdade                                      #
# --------------------------------------------------------------------------- #

def log_mission(entry: str, category: str = "geral", goal_id: str | None = None) -> dict[str, Any]:
    entry = str(entry or "").strip()
    if not entry:
        return {"ok": False, "error": "entry vazio"}
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO mission_log (ts, entry, category, goal_id) VALUES (?,?,?,?)",
            (int(time.time() * 1000), entry, str(category or "geral"), goal_id),
        )
        conn.commit()
        log_id = cur.lastrowid
    finally:
        conn.close()
    return {"ok": True, "id": log_id, "entry": entry, "category": category}


def mission_log(limit: int = 50, category: str = "") -> dict[str, Any]:
    limit = max(1, min(500, int(limit or 50)))
    where, params = ("WHERE category = ?", [category]) if category else ("", [])
    params.append(limit)
    conn = get_conn()
    try:
        rows = conn.execute(
            f"SELECT id, ts, entry, category, goal_id FROM mission_log {where} "
            f"ORDER BY ts DESC LIMIT ?", params
        ).fetchall()
    finally:
        conn.close()
    return {"ok": True, "items": [dict(r) for r in rows], "count": len(rows)}
