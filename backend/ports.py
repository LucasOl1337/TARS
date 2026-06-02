"""Mapa de portas localhost — portas reservadas pelo ecossistema TARS cruzadas
com tudo que está em LISTENING na máquina. Read-only (sem matar processos por
enquanto — o dashboard expõe o botão, mas o endpoint é conservador).

Implementação via `netstat -ano` (Windows) com fallback gracioso.
"""
from __future__ import annotations

import subprocess
import time
from typing import Any

from config import DASHBOARD_PORT, KAMUI_URL, SERVER_PORT, YUME_URL


def _port_from_url(url: str) -> int | None:
    try:
        return int(url.rsplit(":", 1)[1].split("/", 1)[0])
    except Exception:
        return None


def _reserved() -> list[dict[str, Any]]:
    items = [
        {"port": SERVER_PORT, "service": "tars-backend", "label": "TARS Backend", "kind": "core"},
        {"port": DASHBOARD_PORT, "service": "tars-dashboard", "label": "TARS Dashboard", "kind": "core"},
    ]
    yp, kp = _port_from_url(YUME_URL), _port_from_url(KAMUI_URL)
    if yp:
        items.append({"port": yp, "service": "yume", "label": "Yume (bridge)", "kind": "service"})
    if kp:
        items.append({"port": kp, "service": "kamui", "label": "Kamui (bridge)", "kind": "service"})
    return items


def _listening() -> tuple[list[dict[str, Any]], str | None]:
    """Parse `netstat -ano` para conexões em LISTENING. (Windows)."""
    try:
        out = subprocess.run(
            ["netstat", "-ano", "-p", "TCP"],
            capture_output=True, text=True, timeout=10,
        ).stdout
    except Exception as exc:
        return [], str(exc)

    rows: list[dict[str, Any]] = []
    seen: set[tuple[int, int, str]] = set()
    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 4 or parts[0] != "TCP":
            continue
        local, state = parts[1], parts[3]
        if state.upper() != "LISTENING":
            continue
        pid = int(parts[4]) if len(parts) >= 5 and parts[4].isdigit() else 0
        try:
            addr, port_s = local.rsplit(":", 1)
            port = int(port_s)
        except Exception:
            continue
        key = (port, pid, addr)
        if key in seen:
            continue
        seen.add(key)
        rows.append({"port": port, "address": addr, "pid": pid,
                     "process": _pid_name(pid), "proto": "TCP"})
    return rows, None


_PID_CACHE: dict[int, str] = {}


def _pid_name(pid: int) -> str:
    if pid <= 0:
        return "—"
    if pid in _PID_CACHE:
        return _PID_CACHE[pid]
    name = f"pid {pid}"
    try:
        out = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        if out and "," in out:
            name = out.split(",")[0].strip().strip('"') or name
    except Exception:
        pass
    _PID_CACHE[pid] = name
    return name


def build_port_report() -> dict[str, Any]:
    reserved = _reserved()
    active, scan_error = _listening()
    active_by_port: dict[int, list[dict[str, Any]]] = {}
    for a in active:
        active_by_port.setdefault(a["port"], []).append(a)

    reserved_ports = {r["port"]: r for r in reserved}
    for a in active:
        r = reserved_ports.get(a["port"])
        a["reservedBy"] = r["service"] if r else None

    reserved_out = []
    for r in reserved:
        holders = active_by_port.get(r["port"], [])
        in_use = len(holders) > 0
        held = holders[0] if holders else None
        reserved_out.append({
            **r,
            "inUse": in_use,
            "heldBy": ({"pid": held["pid"], "process": held["process"], "address": held["address"]}
                       if held else None),
        })

    return {
        "reserved": reserved_out,
        "active": active,
        "conflicts": [],
        "scannedAt": int(time.time() * 1000),
        "platform": "win32",
        **({"scanError": scan_error} if scan_error else {}),
    }
