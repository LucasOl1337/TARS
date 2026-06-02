"""Bridges — o HUB do TARS.

Registro canônico das pontes para outros projetos do ecossistema. O TARS
alcança cada serviço por aqui; o proxy genérico (em server.py) expõe cada um
sob /api/tars/bridge/<id>/* e loga tudo como "echo".

Adicionar uma ponte = só acrescentar uma entrada em BRIDGES.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

from config import KAMUI_URL, VIDEOGEN_URL, YUME_URL
from db import get_conn, trim_echoes

TIMEOUT_S = float(os.environ.get("TARS_BRIDGE_TIMEOUT_S", "240"))

# Cap por corpo gravado no echo. Respostas como base64 de imagem podem ter
# megabytes; sem isso a tabela echoes incha rápido. Truncamos preservando o
# tamanho original na marca.
ECHO_BODY_MAX = int(os.environ.get("TARS_ECHO_BODY_MAX", "8000"))


def _cap_body(value: str | None) -> str | None:
    if value is None or len(value) <= ECHO_BODY_MAX:
        return value
    return value[:ECHO_BODY_MAX] + f"…[truncado: {len(value)} chars]"


@dataclass(frozen=True)
class BridgeConfig:
    id: str
    label: str
    base_url: str
    role: str
    # path do health check no serviço real
    health_path: str = "/api/health"


BRIDGES: dict[str, BridgeConfig] = {
    "yume": BridgeConfig(
        id="yume",
        label="Yume",
        base_url=YUME_URL,
        role="cérebro de personas e comportamento de IA",
        health_path="/api/health",
    ),
    "kamui": BridgeConfig(
        id="kamui",
        label="Kamui",
        base_url=KAMUI_URL,
        role="hub de inteligência cross-dimensional",
        health_path="/kamui/health",
    ),
    "videogen": BridgeConfig(
        id="videogen",
        label="VideoGen",
        base_url=VIDEOGEN_URL,
        role="geração de imagens, vídeos e assets audiovisuais",
        health_path="/api/health",
    ),
}


def _is_envelopable(content_type: str) -> bool:
    if not content_type:
        return True
    ct = content_type.lower()
    return (
        ct.startswith("application/json")
        or "+json" in ct
        or ct.startswith("text/")
        or ct.startswith("application/xml")
        or ct.startswith("application/yaml")
    )


async def call_bridge(
    bridge_id: str,
    endpoint: str,
    method: str,
    body: Any = None,
    raw_query: str = "",
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Chama um serviço-ponte e devolve um envelope canônico.

    Sempre retorna dict (nunca levanta) — falhas viram {ok: false, error}.
    Respostas binárias ganham um marcador (o byte passthrough fica no proxy
    HTTP do server, que reusa httpx diretamente)."""
    bridge = BRIDGES.get(bridge_id)
    if not bridge:
        return {
            "ok": False, "bridge": bridge_id, "endpoint": endpoint,
            "error": f"bridge '{bridge_id}' não registrada", "elapsed_ms": 0,
        }

    qs = raw_query if raw_query.startswith("?") or not raw_query else "?" + raw_query
    url = f"{bridge.base_url}{endpoint}{qs}"
    fwd = dict(headers or {})
    fwd.setdefault("user-agent", "tars-companion/1.0 (tars-bridge)")
    fwd.setdefault("x-tars-caller", "tars")

    started = time.time()
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            kwargs: dict[str, Any] = {"headers": fwd}
            if body is not None and method.upper() not in ("GET", "HEAD"):
                if isinstance(body, (dict, list)):
                    kwargs["json"] = body
                else:
                    kwargs["content"] = body
            resp = await client.request(method.upper(), url, **kwargs)
        elapsed = int((time.time() - started) * 1000)
        ct = resp.headers.get("content-type", "")
        if not _is_envelopable(ct):
            return {
                "binary": True, "ok": resp.is_success, "bridge": bridge_id,
                "endpoint": endpoint, "status": resp.status_code,
                "content_type": ct, "body": resp.content, "elapsed_ms": elapsed,
            }
        text = resp.text
        data: Any = None
        if text:
            try:
                data = resp.json()
            except Exception:
                data = text
        return {
            "ok": resp.is_success, "bridge": bridge_id, "endpoint": endpoint,
            "status": resp.status_code, "data": data, "elapsed_ms": elapsed,
        }
    except Exception as exc:
        elapsed = int((time.time() - started) * 1000)
        return {
            "ok": False, "bridge": bridge_id, "endpoint": endpoint,
            "error": str(exc), "elapsed_ms": elapsed,
        }


def log_echo(
    bridge_id: str, result: dict[str, Any], method: str,
    request_body: Any = None, source: str = "unknown", trace_id: str | None = None,
) -> None:
    try:
        if result.get("binary"):
            response_body = json.dumps({
                "_binary": True,
                "content_type": result.get("content_type"),
                "bytes": len(result.get("body") or b""),
            })
        else:
            data = result.get("data")
            response_body = (
                data if isinstance(data, str)
                else json.dumps(data) if data is not None else None
            )
        req = (
            request_body if isinstance(request_body, str)
            else json.dumps(request_body) if request_body is not None else None
        )
        response_body = _cap_body(response_body)
        req = _cap_body(req)
        conn = get_conn()
        try:
            conn.execute(
                """INSERT INTO echoes
                   (ts, bridge, endpoint, method, status, ok, elapsed_ms, error,
                    request_body, response_body, source, trace_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    int(time.time() * 1000), bridge_id, result.get("endpoint", ""),
                    method, result.get("status"), 1 if result.get("ok") else 0,
                    result.get("elapsed_ms", 0), result.get("error"),
                    req, response_body, source, trace_id,
                ),
            )
            conn.commit()
            trim_echoes(conn)
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001
        print(f"[TARS] echo insert falhou: {exc}")


async def poll_bridge_health() -> list[dict[str, Any]]:
    """Checa health de cada bridge e persiste o snapshot."""
    snapshots: list[dict[str, Any]] = []
    conn = get_conn()
    try:
        for bridge in BRIDGES.values():
            started = time.time()
            ok, status = False, None
            try:
                async with httpx.AsyncClient(timeout=8.0) as client:
                    resp = await client.get(
                        f"{bridge.base_url}{bridge.health_path}",
                        headers={"x-tars-caller": "tars", "user-agent": "tars-health/1.0"},
                    )
                ok, status = resp.is_success, resp.status_code
            except Exception:
                ok, status = False, None
            elapsed = int((time.time() - started) * 1000)
            conn.execute(
                "INSERT INTO bridge_health (ts, bridge, ok, status, elapsed_ms) VALUES (?,?,?,?,?)",
                (int(time.time() * 1000), bridge.id, 1 if ok else 0, status, elapsed),
            )
            snapshots.append({
                "id": bridge.id, "ok": ok, "status": status, "elapsed_ms": elapsed,
            })
        conn.commit()
        # retém só os últimos ~500 snapshots
        conn.execute(
            "DELETE FROM bridge_health WHERE id NOT IN "
            "(SELECT id FROM bridge_health ORDER BY ts DESC LIMIT 500)"
        )
        conn.commit()
    finally:
        conn.close()
    return snapshots


def latest_bridge_status() -> list[dict[str, Any]]:
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM bridge_health ORDER BY ts DESC LIMIT 500"
        ).fetchall()
    finally:
        conn.close()
    latest: dict[str, Any] = {}
    for row in rows:
        if row["bridge"] not in latest:
            latest[row["bridge"]] = row
    out = []
    for bridge in BRIDGES.values():
        snap = latest.get(bridge.id)
        out.append({
            "id": bridge.id,
            "label": bridge.label,
            "baseUrl": bridge.base_url,
            "role": bridge.role,
            "ok": bool(snap["ok"]) if snap else None,
            "status": snap["status"] if snap else None,
            "elapsed_ms": snap["elapsed_ms"] if snap else None,
            "checked_at": snap["ts"] if snap else None,
            "connection": "unknown" if not snap else ("linked" if snap["ok"] else "severed"),
        })
    return out
