"""Smoke test do runtime agêntico do TARS.

Prova, sem UI e sem depender de API key, que as 6 fases estão de pé:
  - governança (allow/deny de comandos, sandbox)
  - ferramentas reais (fs_*, shell_exec) via o executor unificado
  - memória persistente + mission_log
  - modelo de goal + steps
  - heartbeat (config) e kill-switch
Se um provider LLM estiver configurado, roda também UM objetivo de ponta a
ponta (loop ReAct + verificador). Caso contrário, pula essa parte com aviso.

Uso:  backend\.venv\Scripts\python.exe backend\smoke_test.py
"""
from __future__ import annotations

import asyncio
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")  # console Windows fala cp1252 por padrão
except Exception:
    pass

import config
import governance
import heartbeat as hb
import memory as memory_mod
from brain import available_providers
from db import init_db
from goals import add_step, create_goal, get_goal, get_steps, update_goal
from tools import execute_tool

PASS, FAIL = "[ OK ]", "[FAIL]"
_failures = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global _failures
    mark = PASS if cond else FAIL
    if not cond:
        _failures += 1
    print(f"  {mark} {name}" + (f" - {detail}" if detail else ""))


async def main() -> int:
    print("\n=== TARS smoke test ===\n")
    init_db()

    # 1) Governança ----------------------------------------------------------
    print("[1] Governança")
    v_ok = governance.classify_command("python --version")
    v_rm = governance.classify_command("rm -rf /")
    v_push = governance.classify_command("git push origin main")
    check("comando seguro permitido", v_ok["allowed"], v_ok["reason"])
    check("comando destrutivo bloqueado", not v_rm["allowed"] and v_rm["destructive"], v_rm["reason"])
    check("ação irreversível bloqueada por padrão", not v_push["allowed"], v_push["reason"])
    esc = governance.resolve_in_sandbox("../../etc/passwd")
    check("sandbox barra escape de path", esc is None)
    print(f"      workspace: {governance.workspace_root()}")

    # 2) Ferramentas reais (via executor unificado) --------------------------
    print("\n[2] Ferramentas reais")
    w = await execute_tool("fs_write", {"path": "smoke/hello.txt", "content": "tars-smoke-123"})
    check("fs_write", w.get("ok"), str(w.get("result", {}).get("error", "")))
    r = await execute_tool("fs_read", {"path": "smoke/hello.txt"})
    content = (r.get("result") or {}).get("content", "")
    check("fs_read devolve o conteúdo gravado", "tars-smoke-123" in content)
    ls = await execute_tool("fs_list", {"path": "smoke"})
    check("fs_list lista o arquivo", any(e["name"] == "hello.txt" for e in (ls.get("result") or {}).get("entries", [])))
    sh = await execute_tool("shell_exec", {"command": "echo tars-smoke-shell"})
    sh_out = (sh.get("result") or {}).get("stdout", "")
    check("shell_exec roda comando seguro", sh.get("ok") and "tars-smoke-shell" in sh_out)
    blocked = await execute_tool("shell_exec", {"command": "rm -rf /"})
    check("shell_exec bloqueia destrutivo", not blocked.get("ok"))

    # 3) Memória + mission_log ----------------------------------------------
    print("\n[3] Memória")
    memory_mod.save("O smoke test do TARS rodou", kind="semantic", category="teste", importance=7)
    rec = memory_mod.recall(query="smoke", limit=5)
    check("memory save+recall", rec["count"] >= 1)
    ml = await execute_tool("mission_log", {"entry": "smoke test executado", "category": "teste"})
    check("mission_log persiste", ml.get("ok"))
    log = memory_mod.mission_log(limit=5)
    check("mission_log lê de volta", log["count"] >= 1)

    # 4) Goal + steps --------------------------------------------------------
    print("\n[4] Modelo de objetivo")
    g = create_goal(title="Goal de smoke", description="teste", definition_of_done="existir")
    check("create_goal", bool(g.get("id")))
    add_step(g["id"], 1, "act", thought="pensando", action="think", observation={"ok": True})
    steps = get_steps(g["id"])
    check("add_step + get_steps", len(steps) == 1)
    update_goal(g["id"], status="cancelled")
    check("update_goal", get_goal(g["id"])["status"] == "cancelled")

    # 5) Heartbeat + kill-switch --------------------------------------------
    print("\n[5] Heartbeat / kill-switch")
    st = hb.configure({"enabled": False, "auto_run": True})
    check("heartbeat configura", st["enabled"] is False and st["auto_run"] is True)
    governance.engage_kill_switch(True)
    check("kill-switch liga", governance.kill_switch_engaged())
    check("kill-switch bloqueia shell", not governance.classify_command("python --version")["allowed"])
    governance.engage_kill_switch(False)
    check("kill-switch desliga", not governance.kill_switch_engaged())

    # 6) Loop end-to-end (só se houver provider) ----------------------------
    print("\n[6] Loop agêntico end-to-end")
    provs = available_providers()
    if not any(provs.values()):
        print("  ⚠️  nenhum provider LLM configurado — pulando teste end-to-end.")
        print(f"      providers: {provs}")
    else:
        from agent import run_goal
        goal = create_goal(
            title="Escreva um arquivo de prova",
            description="Crie o arquivo proof.txt no workspace com a frase 'TARS autônomo funciona'.",
            definition_of_done="O arquivo proof.txt existe no workspace e contém a frase exata 'TARS autônomo funciona'.",
            budget={"max_iterations": 8, "max_seconds": 180},
        )
        print(f"      rodando goal {goal['id'][:8]}… (pode levar ~1 min)")
        outcome = await run_goal(goal["id"])
        check("loop concluiu o objetivo (status=done)", outcome.get("status") == "done", str(outcome.get("result"))[:200])
        proof = await execute_tool("fs_read", {"path": "proof.txt"})
        check("arquivo de prova foi criado pelo agente", proof.get("ok"))

    print("\n=== resultado ===")
    if _failures == 0:
        print(f"{PASS} TODOS os checks passaram.\n")
        return 0
    print(f"{FAIL} {_failures} check(s) falharam.\n")
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
