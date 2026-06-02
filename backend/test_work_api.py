"""Prova a superfície de SERVIÇO do TARS (inbound + outbound callback).

Simula OUTRO SERVIÇO: sobe um receptor de callback, manda POST /api/tars/work
com uma tarefa trivial e um callback_url, faz polling em /work/{id} até concluir,
e confirma que o TARS ENTREGOU o resultado de volta no callback.
"""
from __future__ import annotations

import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import httpx

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BACKEND = "http://127.0.0.1:62026"
CALLBACK_PORT = 62099
_received: list[dict] = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # silencia o log do http.server
        pass

    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        body = self.rfile.read(length) if length else b""
        try:
            _received.append(json.loads(body.decode("utf-8")))
        except Exception:
            _received.append({"raw": body.decode("utf-8", "replace")})
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true,"got":"callback"}')


def main() -> int:
    server = HTTPServer(("127.0.0.1", CALLBACK_PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"[serviço externo] receptor de callback em http://127.0.0.1:{CALLBACK_PORT}/done")

    # 1) delega trabalho ao TARS (como outro serviço faria)
    req = {
        "task": "Escreva a palavra pong em um arquivo chamado work_api_test.txt no workspace, usando a ferramenta fs_write.",
        "definition_of_done": "O arquivo work_api_test.txt existe no workspace e contém a palavra 'pong'.",
        "callback_url": f"http://127.0.0.1:{CALLBACK_PORT}/done",
        "budget": {"max_iterations": 6, "max_seconds": 120},
    }
    print("[serviço externo] POST /api/tars/work …")
    r = httpx.post(f"{BACKEND}/api/tars/work", json=req, timeout=30)
    print(f"  -> HTTP {r.status_code}: {r.text[:300]}")
    if r.status_code != 202:
        print("FALHOU: esperava 202 accepted")
        return 1
    job = r.json()
    job_id = job["job_id"]

    # 2) polling em /work/{id} (como outro serviço acompanharia)
    print(f"[serviço externo] polling GET /api/tars/work/{job_id} …")
    deadline = time.time() + 150
    final = None
    while time.time() < deadline:
        s = httpx.get(f"{BACKEND}/api/tars/work/{job_id}", timeout=15).json()
        if s.get("done"):
            final = s
            break
        time.sleep(3)
    print(f"  -> status final: {json.dumps(final, ensure_ascii=False)[:300] if final else 'TIMEOUT'}")

    # 3) confirma a ENTREGA via callback (outbound)
    time.sleep(2)
    print(f"[serviço externo] callbacks recebidos: {len(_received)}")
    cb = _received[-1] if _received else None
    if cb:
        print(f"  -> evento: {cb.get('event')} | status: {cb.get('status')} | ok: {cb.get('ok')}")
        print(f"  -> result: {str(cb.get('result'))[:200]}")

    # veredito
    inbound_ok = bool(final and final.get("done"))
    job_ok = bool(final and final.get("ok"))
    callback_ok = bool(cb and cb.get("event") == "work.completed" and cb.get("job_id") == job_id)
    print("\n=== VEREDITO ===")
    print(f"  inbound (aceitou + executou + status consultável): {'OK' if inbound_ok else 'FALHOU'}")
    print(f"  trabalho concluído com sucesso (verificado):       {'OK' if job_ok else 'FALHOU'}")
    print(f"  outbound (entregou resultado no callback):         {'OK' if callback_ok else 'FALHOU'}")
    server.shutdown()
    return 0 if (inbound_ok and callback_ok) else 1


if __name__ == "__main__":
    sys.exit(main())
