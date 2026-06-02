"""Ativa a missão autônoma de teste: 1 cavalo + 2 leões via Grok Imagine no Desktop.

O TARS recebe APENAS a missão e o critério de sucesso. Ele decide sozinho os
prompts, a contagem, os nomes de arquivo e a orquestração (chamar grok_imagine
3 vezes), e o verificador adversarial confere no fim.
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

import grok_imagine
from agent import run_goal
from db import init_db
from goals import create_goal, get_goal, get_steps


def desktop_image_snapshot(desktop):
    out = {}
    try:
        for name in os.listdir(desktop):
            p = os.path.join(desktop, name)
            if os.path.isfile(p) and name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                out[name] = os.path.getmtime(p)
    except Exception:
        pass
    return out


async def main():
    init_db()
    desktop = str(grok_imagine.desktop_dir())
    print(f"Desktop: {desktop}")
    before = desktop_image_snapshot(desktop)

    goal = create_goal(
        title="Gerar 1 imagem de cavalo e 2 de leão via Grok Imagine e salvar no Desktop",
        description=(
            "Sua missão é produzir imagens usando o Grok Imagine (a ferramenta grok_imagine, "
            "que dirige o Grok Terminal) e salvá-las no Desktop da máquina do usuário "
            f"({desktop}). Você deve gerar exatamente TRÊS imagens: 1 (uma) imagem de um CAVALO "
            "e 2 (duas) imagens DIFERENTES de um LEÃO. Cada chamada da ferramenta grok_imagine "
            "gera uma imagem; portanto você precisará chamá-la três vezes, com prompts adequados "
            "e nomes de arquivo claros e distintos. As imagens devem ficar salvas no Desktop."
        ),
        definition_of_done=(
            f"No Desktop ({desktop}) passaram a existir 3 arquivos de imagem gerados via Grok "
            "Imagine nesta execução: exatamente 1 de cavalo e 2 distintos de leão, cada um salvo "
            "com sucesso e com tamanho maior que zero bytes (confirmado pelas observações da "
            "ferramenta grok_imagine com ok=true e o caminho no Desktop)."
        ),
        budget={"max_iterations": 18, "max_seconds": 1500, "max_tool_calls": 12},
    )
    print(f"GOAL_ID={goal['id']}")
    started = time.time()
    outcome = await run_goal(goal["id"])
    print("\n=== OUTCOME ===")
    print(json.dumps(outcome, ensure_ascii=False, indent=2, default=str))

    print("\n=== TRILHA ===")
    for s in get_steps(goal["id"]):
        extra = ""
        if s["action"] == "grok_imagine" and isinstance(s.get("observation"), dict):
            extra = f" -> {s['observation'].get('saved_to') or s['observation'].get('error')}"
        print(f"#{s['idx']:>2} {s['phase']:7} {s['action']}{extra}")

    print("\n=== NOVOS ARQUIVOS NO DESKTOP ===")
    after = desktop_image_snapshot(desktop)
    new_files = [n for n, m in after.items() if n not in before or m > before.get(n, 0)]
    for n in new_files:
        size = os.path.getsize(os.path.join(desktop, n))
        print(f"  {n}  ({size} bytes)")
    print(f"\nTotal novos: {len(new_files)} | tempo: {int(time.time()-started)}s | status: {outcome.get('status')}")


if __name__ == "__main__":
    asyncio.run(main())
