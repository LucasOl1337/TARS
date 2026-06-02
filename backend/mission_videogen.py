"""Missão real cross-app: TARS dispara o pipeline sandbox2 do VideoGen VIA KAMUI
e publica um vídeo no YouTube. Publicação autorizada explicitamente pelo usuário.

Divisão (igual aos outros testes):
  - O TARS, de forma autônoma, usa kamui_call para POSTar /api/sandbox2/run via
    Kamui, captura o operationId do 202, e confirma via GET que está rodando.
  - Eu (runner) monitoro o pipeline de forma INDEPENDENTE até publicar (ou falhar),
    e reporto a URL do vídeo no YouTube.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import httpx

from db import init_db, set_state
from goals import create_goal, get_steps
from agent import run_goal

KAMUI = "http://127.0.0.1:1338"
VIDEOGEN = "http://127.0.0.1:4197"
CHANNEL_ID = "UCE6KhS-qs-igyVnlIRugyZw"
CHANNEL_NAME = "Guess The Song Lab"
DESK = os.path.join(os.environ.get("USERPROFILE", os.path.expanduser("~")), "Desktop")
MISS_DIR = os.path.join(DESK, "TARS-missoes")


def find_operation_id(goal_id: str) -> str | None:
    """Vasculha as observações dos passos por um operationId/queueItemId."""
    for s in get_steps(goal_id):
        obs = s.get("observation")
        if not isinstance(obs, dict):
            continue
        # observação do kamui_call: {..., "data": <envelope kamui> }
        for blob in (obs, obs.get("data") if isinstance(obs.get("data"), dict) else None):
            if not isinstance(blob, dict):
                continue
            data = blob.get("data") if isinstance(blob.get("data"), dict) else blob
            for key in ("operationId", "queueItemId", "operation_id"):
                if isinstance(data, dict) and data.get(key):
                    return str(data[key])
            if isinstance(data, dict) and isinstance(data.get("operation"), dict):
                if data["operation"].get("id"):
                    return str(data["operation"]["id"])
    return None


def poll_operation_until_done(op_id: str, timeout_s: int = 2700) -> dict:
    """Monitoramento INDEPENDENTE direto no VideoGen até terminar/timeout."""
    started = time.time()
    last_step = None
    final = {}
    while time.time() - started < timeout_s:
        try:
            r = httpx.get(f"{VIDEOGEN}/api/operations/{op_id}", timeout=15)
            op = r.json()
        except Exception as e:
            print(f"  [poll] erro: {e}")
            time.sleep(15)
            continue
        op_obj = op.get("operation") if isinstance(op.get("operation"), dict) else op
        status = op_obj.get("status")
        prog = op_obj.get("progress") or {}
        step = prog.get("activeStep") or prog.get("currentInfo") or status
        if step != last_step:
            print(f"  [poll +{int(time.time()-started)}s] status={status} step={step}")
            last_step = step
        if status in ("done", "completed", "failed", "error", "cancelled"):
            final = op_obj
            break
        time.sleep(15)
    return final or {"status": "timeout"}


async def main():
    init_db()
    set_state("extra_roots", [DESK])
    os.makedirs(MISS_DIR, exist_ok=True)

    # pré-checagem de conectividade (não é parte do trabalho do agente)
    try:
        h = httpx.get(f"{KAMUI}/kamui/videogen/api/health", timeout=8)
        print(f"Kamui->VideoGen health via proxy: {h.status_code}")
    except Exception as e:
        print(f"ABORT: Kamui/VideoGen indisponível: {e}")
        return

    goal = create_goal(
        title="Disparar o pipeline sandbox2 do VideoGen via Kamui e publicar um vídeo",
        description=(
            "O VideoGen é um app conectado ao Kamui. Através do Kamui, dispare o pipeline "
            "completo 'sandbox2' do VideoGen para PRODUZIR e PUBLICAR um vídeo curto (shorts) "
            f"no canal '{CHANNEL_NAME}'. Use a ferramenta kamui_call.\n\n"
            "Fatos verificados que você deve usar:\n"
            f"- Para chamar o VideoGen via Kamui, use endpoints com o prefixo '/kamui/videogen/...'.\n"
            f"- Endpoint de disparo: POST /kamui/videogen/api/sandbox2/run\n"
            "  body: {\"text\": <um briefing curto e on-theme para o canal>, \"format\": \"shorts\", "
            '"targetChannelId": "' + CHANNEL_ID + '"}. Passar o targetChannelId faz o pipeline publicar no canal ao final.\n'
            "- A resposta vem como 202 com 'operationId'/'queueItemId'.\n"
            "- Para acompanhar: GET /kamui/videogen/api/operations/{operationId}.\n\n"
            "Passos: (1) dispare o pipeline com kamui_call POST; (2) capture o operationId da resposta; "
            "(3) confirme com kamui_call GET no operations/{id} que a operação existe e está em execução; "
            f"(4) salve um resumo em '{MISS_DIR}\\videogen-post.md' com o operationId, o canal e o status inicial."
        ),
        definition_of_done=(
            "O pipeline sandbox2 foi disparado via Kamui (kamui_call POST em /kamui/videogen/api/sandbox2/run "
            f"com targetChannelId do canal {CHANNEL_NAME}); a resposta 202 com operationId/queueItemId foi capturada; "
            "e foi confirmado via GET /kamui/videogen/api/operations/{id} (via Kamui) que a operação existe e está "
            f"em execução/progresso. Um resumo foi salvo em {MISS_DIR}\\videogen-post.md."
        ),
        budget={"max_iterations": 12, "max_seconds": 300, "max_tool_calls": 10},
    )
    print(f"GOAL_ID={goal['id']}")

    outcome = await run_goal(goal["id"])
    print("\n=== OUTCOME (agente) ===")
    print(json.dumps(outcome, ensure_ascii=False, indent=2, default=str))
    print("\n=== TRILHA ===")
    for s in get_steps(goal["id"]):
        act = s["action"]
        extra = ""
        if isinstance(s.get("observation"), dict):
            d = s["observation"]
            extra = f" ok={d.get('ok')}"
        print(f"#{s['idx']:>2} {s['phase']:7} {act}{extra}")

    op_id = find_operation_id(goal["id"])
    print(f"\noperationId capturado pelo agente: {op_id}")
    if not op_id:
        print("Não consegui extrair operationId das observações; o agente pode não ter disparado corretamente.")
        return

    print("\n=== MONITORAMENTO INDEPENDENTE do pipeline até publicar ===")
    final = poll_operation_until_done(op_id)
    status = final.get("status")
    prog = final.get("progress") or {}
    steps = prog.get("steps") or {}
    upload = steps.get("upload", {}) if isinstance(steps, dict) else {}
    up_data = upload.get("data") or {}
    video_url = (up_data.get("preflight") or {}).get("videoUrl") or up_data.get("videoUrl") \
        or prog.get("videoUrl") or final.get("videoUrl")
    print(f"\nSTATUS FINAL: {status}")
    print(f"etapas: {list(steps.keys()) if isinstance(steps,dict) else steps}")
    print(f"upload step status: {upload.get('status')}")
    print(f"VIDEO URL (se publicado): {video_url}")

    # salva relatório independente
    try:
        with open(os.path.join(MISS_DIR, "videogen-monitor.json"), "w", encoding="utf-8") as fh:
            json.dump(final, fh, ensure_ascii=False, indent=2, default=str)
    except Exception:
        pass


if __name__ == "__main__":
    asyncio.run(main())
