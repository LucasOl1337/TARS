"""Governança — o cinto de segurança do TARS autônomo.

Um agente autônomo com acesso a shell/filesystem é a coisa mais perigosa que
roda num PC. Este módulo é a barreira entre "o modelo decidiu" e "a máquina
executou":

  - sandbox de caminhos (ler/escrever/executar só dentro do workspace);
  - allowlist do executável-base + denylist de padrões destrutivos no shell;
  - classificação de irreversibilidade (push/delete/format/shutdown...) — por
    padrão BLOQUEADA em modo autônomo (sem humano pra confirmar);
  - kill-switch global persistido (para tudo na hora);
  - orçamentos (iterações/tempo/tool-calls/tokens) vivem no registro do goal e
    são checados pelo agent.py — aqui ficam só os defaults.

Tudo é conservador por padrão. Para afrouxar, use variáveis de ambiente
(TARS_SHELL_ALLOW, TARS_ALLOW_IRREVERSIBLE, TARS_WORKSPACE) ou o agent_state.
"""
from __future__ import annotations

import os
import re
import shlex
from pathlib import Path
from typing import Any

from config import TARS_DIR
from db import get_state, set_state


# --------------------------------------------------------------------------- #
# Sandbox de caminhos                                                          #
# --------------------------------------------------------------------------- #

def workspace_root() -> Path:
    """Raiz onde o TARS pode operar. Default: <TARS>/workspace (criada se faltar)."""
    raw = os.environ.get("TARS_WORKSPACE", str(TARS_DIR / "workspace"))
    root = Path(raw).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def allowed_roots() -> list[Path]:
    """Raízes onde o TARS pode operar. Sempre inclui o workspace; raízes extras
    (ex: Desktop) podem ser habilitadas via agent_state['extra_roots'] ou a env
    TARS_EXTRA_WRITE_ROOTS (separadas por os.pathsep). Default: só o workspace."""
    roots = [workspace_root()]
    extra: list[str] = []
    state_extra = get_state("extra_roots", []) or []
    if isinstance(state_extra, list):
        extra.extend(str(x) for x in state_extra)
    env = os.environ.get("TARS_EXTRA_WRITE_ROOTS", "")
    extra.extend(x for x in env.split(os.pathsep) if x.strip())
    for r in extra:
        try:
            p = Path(r).resolve()
            p.mkdir(parents=True, exist_ok=True)
            roots.append(p)
        except Exception:
            continue
    return roots


def resolve_in_sandbox(path: str | os.PathLike[str]) -> Path | None:
    """Resolve `path` (relativo ao workspace, se relativo) e garante que ele
    fica DENTRO de alguma raiz permitida. Devolve o Path resolvido ou None."""
    roots = allowed_roots()
    p = Path(path)
    candidate = (p if p.is_absolute() else roots[0] / p).resolve()
    for root in roots:
        try:
            candidate.relative_to(root)
            return candidate
        except ValueError:
            continue
    return None


# --------------------------------------------------------------------------- #
# Shell — allowlist + denylist                                                 #
# --------------------------------------------------------------------------- #

# Executável-base permitido (primeiro token do comando). Foco: trabalho de dev.
_DEFAULT_SHELL_ALLOW = (
    "python,python3,py,pip,pip3,uv,uvx,"
    "node,npm,npx,pnpm,yarn,bun,deno,tsc,"
    "git,gh,"
    "pytest,ruff,black,mypy,eslint,prettier,vitest,jest,"
    "ls,dir,cat,type,echo,pwd,cd,head,tail,wc,find,findstr,grep,rg,fd,"
    "mkdir,touch,cp,copy,mv,move,tree,where,which,whoami,date,hostname,"
    "curl,http,ping,"
    "go,cargo,rustc,java,javac,mvn,gradle,dotnet,make"
)


def _shell_allow() -> set[str]:
    raw = os.environ.get("TARS_SHELL_ALLOW", _DEFAULT_SHELL_ALLOW)
    return {tok.strip().lower() for tok in raw.split(",") if tok.strip()}


# Padrões DESTRUTIVOS — bloqueados sempre, independente da allowlist.
_DENY_PATTERNS = [
    r"\brm\b.*-[a-z]*r[a-z]*f",          # rm -rf / rm -fr
    r"\brm\b\s+-[a-z]*f[a-z]*r",
    r"\bdel\b\s+/[sq]",                   # del /s /q
    r"\brmdir\b\s+/s",                    # rmdir /s
    r"\bformat\b",                        # format c:
    r"\bmkfs",                            # mkfs.*
    r"\bdd\b\s+if=",                      # dd if=...
    r":\(\)\s*\{",                        # fork bomb :(){ :|:& };:
    r"\bshutdown\b", r"\breboot\b", r"\bhalt\b", r"\bpoweroff\b",
    r"\bdiskpart\b", r"\bfdisk\b",
    r"\b(Remove-Item|rd)\b.*-Recurse.*-Force",
    r">\s*/dev/sd", r"\bchmod\b\s+-R\s+777\s+/",
    r"\bcurl\b[^|]*\|\s*(ba)?sh",         # curl ... | sh  (exec remoto)
    r"\bwget\b[^|]*\|\s*(ba)?sh",
    r"\bgit\b\s+push\b.*--force", r"\bgit\b\s+push\b.*-f\b",
    r"\bnpm\b\s+publish", r"\bpip\b\s+.*--break-system-packages",
]

# Padrões IRREVERSÍVEIS / de alto impacto — bloqueados em modo autônomo a menos
# que TARS_ALLOW_IRREVERSIBLE esteja ligado. Não são destrutivos per se, mas
# têm efeito externo / difícil de desfazer.
_IRREVERSIBLE_PATTERNS = [
    r"\bgit\b\s+push", r"\bgh\b\s+(pr|release|repo)\b",
    r"\bnpm\b\s+(publish|deprecate)", r"\bpip\b\s+upload", r"\btwine\b",
    r"\bdocker\b\s+(push|rmi|system\s+prune)",
    r"\bkubectl\b\s+(delete|apply)", r"\bterraform\b\s+(apply|destroy)",
    r"\bdel\b", r"\bRemove-Item\b", r"\brmdir\b", r"\brm\b",
    r"\bmove\b", r"\bmv\b",
    r"\b(POST|PUT|DELETE|PATCH)\b",        # curl -X POST etc.
    r"\bcurl\b.*\s-X\s", r"\bcurl\b.*\s-d\s", r"\bcurl\b.*--data",
]


def allow_irreversible() -> bool:
    if str(os.environ.get("TARS_ALLOW_IRREVERSIBLE", "")).strip().lower() in ("1", "true", "yes", "on"):
        return True
    return bool(get_state("allow_irreversible", False))


def _first_token(cmd: str) -> str:
    cmd = cmd.strip()
    if not cmd:
        return ""
    try:
        parts = shlex.split(cmd, posix=False)
    except ValueError:
        parts = cmd.split()
    if not parts:
        return ""
    base = parts[0].strip().strip('"').strip("'")
    base = base.replace("\\", "/").split("/")[-1]   # caminho → nome do binário
    if base.lower().endswith(".exe"):
        base = base[:-4]
    return base.lower()


def classify_command(cmd: str) -> dict[str, Any]:
    """Classifica um comando de shell. Devolve:
        {allowed: bool, reason: str, base: str, irreversible: bool, destructive: bool}
    """
    cmd = (cmd or "").strip()
    if not cmd:
        return {"allowed": False, "reason": "comando vazio", "base": "",
                "irreversible": False, "destructive": False}

    if kill_switch_engaged():
        return {"allowed": False, "reason": "KILL-SWITCH ativo — execução suspensa",
                "base": _first_token(cmd), "irreversible": False, "destructive": False}

    low = cmd.lower()

    for pat in _DENY_PATTERNS:
        if re.search(pat, low):
            return {"allowed": False, "reason": f"padrão destrutivo bloqueado: /{pat}/",
                    "base": _first_token(cmd), "irreversible": True, "destructive": True}

    irreversible = any(re.search(pat, cmd, re.IGNORECASE) for pat in _IRREVERSIBLE_PATTERNS)
    if irreversible and not allow_irreversible():
        return {"allowed": False,
                "reason": "ação irreversível/alto-impacto requer aprovação humana "
                          "(ligue TARS_ALLOW_IRREVERSIBLE ou agent_state.allow_irreversible)",
                "base": _first_token(cmd), "irreversible": True, "destructive": False}

    base = _first_token(cmd)
    allow = _shell_allow()
    # "*" libera qualquer executável-base (ainda passa por deny/irreversible).
    if "*" not in allow and base not in allow:
        return {"allowed": False,
                "reason": f"executável '{base}' não está na allowlist (TARS_SHELL_ALLOW)",
                "base": base, "irreversible": irreversible, "destructive": False}

    return {"allowed": True, "reason": "ok", "base": base,
            "irreversible": irreversible, "destructive": False}


# --------------------------------------------------------------------------- #
# Kill-switch                                                                  #
# --------------------------------------------------------------------------- #

def kill_switch_engaged() -> bool:
    return bool(get_state("kill_switch", False))


def engage_kill_switch(on: bool = True) -> None:
    set_state("kill_switch", bool(on))


# --------------------------------------------------------------------------- #
# Defaults de orçamento (o agente lê/sobrescreve por goal)                     #
# --------------------------------------------------------------------------- #

DEFAULT_BUDGET = {
    "max_iterations": int(os.environ.get("TARS_MAX_ITERATIONS", "12")),
    "max_seconds": int(os.environ.get("TARS_MAX_SECONDS", "300")),
    "max_tool_calls": int(os.environ.get("TARS_MAX_TOOL_CALLS", "40")),
    "max_subagent_depth": int(os.environ.get("TARS_MAX_SUBAGENT_DEPTH", "2")),
}


def policy_summary() -> str:
    """Resumo legível da política — injetado no system prompt do agente."""
    allow = sorted(_shell_allow())
    allow_str = "qualquer (allowlist='*')" if "*" in allow else ", ".join(allow[:24]) + ("…" if len(allow) > 24 else "")
    roots = allowed_roots()
    roots_str = "; ".join(str(r) for r in roots)
    return (
        "## Política de execução (governança)\n"
        f"- Workspace (sandbox): {workspace_root()}\n"
        f"- Raízes onde pode ler/escrever/executar: {roots_str}\n"
        f"- Shell allowlist: {allow_str}\n"
        "- Comandos destrutivos (rm -rf, format, shutdown, fork-bomb, curl|sh) são SEMPRE bloqueados.\n"
        f"- Ações irreversíveis (git push, publish, delete, HTTP de escrita): "
        f"{'permitidas' if allow_irreversible() else 'BLOQUEADAS — peça que o humano faça'}.\n"
        "- Se uma ação for bloqueada, NÃO insista: registre no resultado o que precisaria de aprovação humana."
    )
