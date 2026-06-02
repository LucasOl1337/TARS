"""Missões difíceis para provar e estressar o TARS autônomo.

Três missões multi-etapa, cada uma exercitando capacidades diferentes:
  A) coding + auto-correção: escrever, RODAR e salvar um programa correto;
  B) artefato criativo multi-ferramenta: 2 imagens (Grok Imagine) + HTML;
  C) decomposição com sub-agentes: 2 sub-tarefas + relatório compilado.

O TARS recebe APENAS missão + critério. Eu confiro os resultados de forma
INDEPENDENTE (não confio só na palavra do agente).
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from db import init_db, set_state
from goals import create_goal, get_steps
from agent import run_goal

DESK = os.path.join(os.environ.get("USERPROFILE", os.path.expanduser("~")), "Desktop")
MISS_DIR = os.path.join(DESK, "TARS-missoes")
GAL_DIR = os.path.join(DESK, "TARS-galeria")


# ---------- verificações independentes (ground truth calculado aqui) -------- #

def _is_prime(n: int) -> bool:
    if n < 2:
        return False
    if n % 2 == 0:
        return n == 2
    i = 3
    while i * i <= n:
        if n % i == 0:
            return False
        i += 2
    return True


def expected_fib_primes(limit: int = 1_000_000) -> set[int]:
    a, b = 1, 1
    out = set()
    while a < limit:
        if _is_prime(a):
            out.add(a)
        a, b = b, a + b
    return out


def expected_prime_sum(limit: int = 100_000) -> int:
    sieve = bytearray([1]) * limit
    sieve[0] = sieve[1] = 0
    for i in range(2, int(limit ** 0.5) + 1):
        if sieve[i]:
            sieve[i * i::i] = bytearray(len(sieve[i * i::i]))
    return sum(i for i in range(limit) if sieve[i])


def ints_in_file(path: str) -> set[int]:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except Exception:
        return set()
    return {int(x) for x in re.findall(r"\d+", text)}


def check_A() -> dict:
    script = os.path.join(MISS_DIR, "fib_primes.py")
    # aceita qualquer .txt de saída na pasta da missão
    outs = [os.path.join(MISS_DIR, f) for f in os.listdir(MISS_DIR)] if os.path.isdir(MISS_DIR) else []
    txts = [p for p in outs if p.lower().endswith((".txt", ".out", ".log"))]
    found_ints: set[int] = set()
    for p in txts:
        found_ints |= ints_in_file(p)
    exp = expected_fib_primes()
    return {
        "script_exists": os.path.isfile(script),
        "output_files": [os.path.basename(p) for p in txts],
        "expected_fib_primes": sorted(exp),
        "all_present": exp.issubset(found_ints),
        "pass": os.path.isfile(script) and exp.issubset(found_ints),
    }


def check_B() -> dict:
    if not os.path.isdir(GAL_DIR):
        return {"pass": False, "reason": "pasta da galeria não existe"}
    files = os.listdir(GAL_DIR)
    imgs = [f for f in files if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))
            and os.path.getsize(os.path.join(GAL_DIR, f)) > 0]
    htmls = [f for f in files if f.lower().endswith(".html")]
    html_refs_ok = False
    if htmls:
        html_text = open(os.path.join(GAL_DIR, htmls[0]), encoding="utf-8", errors="replace").read().lower()
        html_refs_ok = sum(1 for im in imgs if im.lower() in html_text) >= 2
    return {
        "images": imgs, "html": htmls, "html_references_both": html_refs_ok,
        "pass": len(imgs) >= 2 and bool(htmls) and html_refs_ok,
    }


def check_C() -> dict:
    report = os.path.join(MISS_DIR, "report.md")
    if not os.path.isfile(report):
        return {"pass": False, "reason": "report.md não existe"}
    text = open(report, encoding="utf-8", errors="replace").read()
    nums = {int(x) for x in re.findall(r"\d+", text.replace(".", "").replace(",", ""))}
    exp_sum = expected_prime_sum()
    has_sum = exp_sum in nums
    # alguma imagem de coruja no Desktop?
    owl = None
    for root in (DESK, MISS_DIR):
        if os.path.isdir(root):
            for f in os.listdir(root):
                if re.search(r"coruja|owl", f, re.I) and f.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                    owl = os.path.join(root, f)
    return {
        "report_exists": True, "expected_prime_sum": exp_sum,
        "sum_in_report": has_sum, "owl_image": owl,
        "pass": has_sum and bool(owl),
    }


# ---------- missões ---------------------------------------------------------- #

MISSIONS = [
    {
        "key": "A",
        "title": "Programa Python dos primos de Fibonacci < 1.000.000 (rodar e salvar no Desktop)",
        "description": (
            f"Escreva um programa Python que calcule TODOS os números de Fibonacci abaixo de "
            f"1.000.000 e imprima os que são primos. Salve o script como '{MISS_DIR}\\fib_primes.py', "
            f"EXECUTE-O com python via shell_exec, e salve a saída em "
            f"'{MISS_DIR}\\fib_primes_output.txt'. Os números devem ser COMPUTADOS pelo programa "
            "(não escritos à mão). Se a execução falhar ou a saída parecer errada, corrija o script e rode de novo."
        ),
        "dod": (
            f"Em {MISS_DIR} existem fib_primes.py e fib_primes_output.txt; o script foi executado "
            "com sucesso (exit_code 0) via shell_exec; e o arquivo de saída lista os primos de "
            "Fibonacci abaixo de 1.000.000 computados pelo programa."
        ),
        "budget": {"max_iterations": 14, "max_seconds": 420, "max_tool_calls": 16},
        "check": check_A,
    },
    {
        "key": "B",
        "title": "Mini-galeria no Desktop: 2 imagens via Grok Imagine + index.html",
        "description": (
            f"Crie uma mini-galeria na pasta '{GAL_DIR}'. Gere DUAS imagens temáticas e distintas "
            "via Grok Imagine (a ferramenta grok_imagine) — você escolhe os temas (ex: uma cidade "
            "futurista e um lago sereno nas montanhas) — salvando-as nessa pasta. Depois escreva um "
            "'index.html' nessa mesma pasta que exiba as duas imagens com títulos/legendas, "
            "referenciando os arquivos de imagem por nome (tags <img src>)."
        ),
        "dod": (
            f"Em {GAL_DIR} existem 2 imagens distintas (>0 bytes) geradas via Grok Imagine e um "
            "index.html válido cujo conteúdo referencia (via <img src>) os 2 arquivos de imagem pelo nome."
        ),
        "budget": {"max_iterations": 12, "max_seconds": 600, "max_tool_calls": 10},
        "check": check_B,
    },
    {
        "key": "C",
        "title": "Decomposição com sub-agentes: somar primos + imagem + relatório",
        "description": (
            "Use sub-agentes (a ferramenta spawn_subagent) para resolver DUAS sub-tarefas independentes "
            "e depois compile um relatório. Sub-tarefa 1: escrever e RODAR um script Python que calcule a "
            "SOMA de todos os números primos abaixo de 100.000 (imprima a soma). Sub-tarefa 2: gerar uma "
            f"imagem de uma CORUJA via grok_imagine salvando no Desktop como 'coruja.png'. Por fim, escreva "
            f"'{MISS_DIR}\\report.md' resumindo: o valor exato da soma dos primos e o caminho da imagem da coruja."
        ),
        "dod": (
            f"Existe {MISS_DIR}\\report.md contendo o valor EXATO da soma de todos os primos abaixo de "
            "100.000 (computado por um script) e o caminho de uma imagem de coruja gerada via Grok Imagine "
            "no Desktop. As duas sub-tarefas foram delegadas via spawn_subagent."
        ),
        "budget": {"max_iterations": 16, "max_seconds": 800, "max_tool_calls": 12},
        "check": check_C,
    },
]


async def main():
    init_db()
    set_state("extra_roots", [DESK])  # habilita o Desktop como raiz de escrita
    os.makedirs(MISS_DIR, exist_ok=True)
    os.makedirs(GAL_DIR, exist_ok=True)
    # limpa probe de selftest, se houver
    try:
        import shutil
        shutil.rmtree(os.path.join(DESK, "TARS-selftest"), ignore_errors=True)
    except Exception:
        pass

    print(f"Desktop: {DESK}")
    summary = []
    for m in MISSIONS:
        print(f"\n{'='*70}\nMISSÃO {m['key']}: {m['title']}\n{'='*70}")
        goal = create_goal(title=m["title"], description=m["description"],
                           definition_of_done=m["dod"], budget=m["budget"])
        t0 = time.time()
        outcome = await run_goal(goal["id"])
        elapsed = int(time.time() - t0)
        steps = get_steps(goal["id"])
        tools_used = [s["action"] for s in steps if s["phase"] == "act"]
        print(f"status={outcome.get('status')} | iters={outcome.get('iterations')} "
              f"| tools={outcome.get('tool_calls')} | {elapsed}s")
        print(f"ferramentas usadas: {tools_used}")
        print(f"verificador(LLM): passed={(outcome.get('verifier') or {}).get('passed')}")
        check = m["check"]()
        print(f"VERIFICAÇÃO INDEPENDENTE: {json.dumps(check, ensure_ascii=False, default=str)}")
        summary.append({
            "missao": m["key"], "status": outcome.get("status"),
            "verifier_passed": (outcome.get("verifier") or {}).get("passed"),
            "independent_pass": check.get("pass"), "elapsed_s": elapsed,
            "tools": tools_used,
        })

    print(f"\n{'#'*70}\n=== RESUMO FINAL ===")
    for s in summary:
        ok = "PASSOU" if s["independent_pass"] else "FALHOU"
        print(f"  Missão {s['missao']}: {ok} (status={s['status']}, "
              f"verifier={s['verifier_passed']}, {s['elapsed_s']}s) tools={s['tools']}")
    n_pass = sum(1 for s in summary if s["independent_pass"])
    print(f"\nResultado: {n_pass}/{len(summary)} missões aprovadas na verificação independente.")


if __name__ == "__main__":
    asyncio.run(main())
