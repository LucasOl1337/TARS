"""Grok Imagine — capacidade de geração de imagem do TARS via Grok Terminal.

O TARS não gera imagem sozinho: ele DIRIGE o `grok` (a TUI agêntica da xAI, "Grok
Terminal"), cujo slash-command nativo `/imagine` usa o Grok Imagine. O grok salva
a imagem na pasta de sessão dele (~/.grok/sessions/...); este módulo localiza a
imagem recém-criada e a copia para o destino pedido (ex: Desktop).

Padrão portado do runner comprovado do usuário (VideoGen/FLUXO/gerar-imagens/
grok-terminal-image-runner.mjs): invocação headless
  grok --cwd <dir> -p "/imagine <prompt>..." --no-subagents --output-format plain
e depois varredura da pasta de sessão por uma imagem nova e utilizável.
"""
from __future__ import annotations

import os
import hashlib
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from config import TARS_DIR

_IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")
_MIN_BYTES = 15000  # descarta thumbnails/placeholders


def grok_executable() -> str:
    found = shutil.which("grok")
    if found:
        return found
    candidate = Path.home() / ".grok" / "bin" / "grok.exe"
    return str(candidate) if candidate.exists() else "grok"


def desktop_dir() -> Path:
    # Desktop nativo do Windows (sem redirecionamento OneDrive nesta máquina).
    profile = os.environ.get("USERPROFILE") or str(Path.home())
    return Path(profile) / "Desktop"


def _session_roots() -> list[Path]:
    override = os.environ.get("GROK_SESSIONS_DIR")
    if override:
        return [Path(override)]
    return [Path.home() / ".grok" / "sessions"]


def _grok_cwd() -> Path:
    cwd = TARS_DIR / "workspace" / ".grok-imagine"
    cwd.mkdir(parents=True, exist_ok=True)
    return cwd


def _scan_images(roots: list[Path]) -> dict[str, float]:
    """Mapa {path_normalizado: mtime} de todas as imagens sob os roots."""
    found: dict[str, float] = {}

    def walk(cur: Path, depth: int = 0) -> None:
        if depth > 9:
            return
        try:
            entries = list(cur.iterdir())
        except OSError:
            return
        for e in entries:
            try:
                if e.is_dir():
                    walk(e, depth + 1)
                elif e.suffix.lower() in _IMAGE_EXTS:
                    found[str(e).lower()] = e.stat().st_mtime
            except OSError:
                continue

    for root in roots:
        if root.exists():
            walk(root)
    return found


def _find_new_image(roots: list[Path], snapshot: dict[str, float], after_ts: float) -> Path | None:
    """Acha a imagem mais recente, utilizável, que NÃO estava no snapshot."""
    best: tuple[float, Path] | None = None

    def walk(cur: Path, depth: int = 0) -> None:
        nonlocal best
        if depth > 9:
            return
        try:
            entries = list(cur.iterdir())
        except OSError:
            return
        for e in entries:
            try:
                if e.is_dir():
                    walk(e, depth + 1)
                    continue
                if e.suffix.lower() not in _IMAGE_EXTS:
                    continue
                key = str(e).lower()
                st = e.stat()
                if key in snapshot and st.st_mtime <= snapshot[key] + 0.5:
                    continue  # já existia e não mudou
                if st.st_mtime + 1.0 < after_ts:
                    continue  # velha demais
                if st.st_size < _MIN_BYTES:
                    continue  # placeholder
                if best is None or st.st_mtime > best[0]:
                    best = (st.st_mtime, e)
            except OSError:
                continue

    for root in roots:
        if root.exists():
            walk(root)
    return best[1] if best else None


def _usable_image(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size >= _MIN_BYTES
    except OSError:
        return False


def _stable_name(idempotency_key: str) -> str:
    digest = hashlib.sha256(idempotency_key.encode("utf-8", "replace")).hexdigest()[:16]
    return f"grok-imagine-{digest}.png"


def _resolve_dest(
    filename: str | None,
    dest: str | None,
    output_path: str | None,
    idempotency_key: str | None = None,
) -> Path:
    if output_path:
        p = Path(output_path)
        return p if p.is_absolute() else (desktop_dir() / p)
    base = Path(dest) if dest else desktop_dir()
    name = filename or (_stable_name(idempotency_key) if idempotency_key else f"grok-imagine-{int(time.time())}.png")
    return base / name


def _build_imagine_prompt(prompt: str, started: float, force: bool) -> str:
    nonce = ""
    if force:
        nonce = (
            f"\nGeneration request id: tars-{int(started * 1000)}. "
            "This id is only to avoid cached execution; do not render it."
        )
    return (
        f"/imagine {prompt}{nonce}\n"
        "Do not add text or watermark.\n"
        "When the image is generated, answer only with a short confirmation."
    )


def _run_grok(full_prompt: str, timeout: int) -> tuple[str, str]:
    cmd = [
        grok_executable(), "--cwd", str(_grok_cwd()),
        "-p", full_prompt, "--no-subagents", "--output-format", "plain",
    ]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
            encoding="utf-8", errors="replace", cwd=str(_grok_cwd()),
        )
        return proc.stdout or "", proc.stderr or ""
    except subprocess.TimeoutExpired as exc:
        stdout = (exc.stdout or b"").decode("utf-8", "replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
        stderr = (exc.stderr or b"").decode("utf-8", "replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
        # o grok pode ter gerado a imagem mesmo após o timeout do confirm — segue pra varredura
        return stdout, stderr


def generate(
    prompt: str,
    filename: str | None = None,
    dest: str | None = None,
    output_path: str | None = None,
    timeout: int = 200,
    force: bool = False,
    reuse_existing: bool = False,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    prompt = str(prompt or "").strip()
    if not prompt:
        return {"ok": False, "error": "prompt vazio"}

    # governança: respeita o kill-switch
    try:
        from governance import kill_switch_engaged
        if kill_switch_engaged():
            return {"ok": False, "error": "kill-switch ativo"}
    except Exception:
        pass

    dest_path = _resolve_dest(filename, dest, output_path, idempotency_key)
    # destino deve ficar sob o perfil do usuário ou o workspace do TARS
    home = Path(os.environ.get("USERPROFILE") or Path.home()).resolve()
    try:
        dest_resolved = dest_path.resolve()
        under_home = str(dest_resolved).lower().startswith(str(home).lower())
        under_ws = str(dest_resolved).lower().startswith(str((TARS_DIR / "workspace").resolve()).lower())
        if not (under_home or under_ws):
            return {"ok": False, "error": f"destino fora das áreas permitidas: {dest_resolved}"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"destino inválido: {exc}"}
    dest_resolved.parent.mkdir(parents=True, exist_ok=True)

    if reuse_existing and not force and _usable_image(dest_resolved):
        return {
            "ok": True,
            "reused": True,
            "saved_to": str(dest_resolved),
            "bytes": dest_resolved.stat().st_size,
            "exists": True,
            "prompt": prompt,
            "idempotency_key": idempotency_key,
        }

    roots = _session_roots()
    snapshot = _scan_images(roots)
    started = time.time()

    stdout = stderr = ""
    try:
        stdout, stderr = _run_grok(_build_imagine_prompt(prompt, started, force), timeout)
    except FileNotFoundError:
        return {"ok": False, "error": "executável 'grok' não encontrado no PATH"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"falha ao executar grok: {exc}"}

    combined_output = f"{stdout}\n{stderr}"
    skipped_previous = "Skipped (previously executed)" in combined_output
    retried_after_skip = False
    if skipped_previous and not force:
        if reuse_existing and _usable_image(dest_resolved):
            return {
                "ok": True,
                "reused": True,
                "skipped_provider": True,
                "saved_to": str(dest_resolved),
                "bytes": dest_resolved.stat().st_size,
                "exists": True,
                "prompt": prompt,
                "idempotency_key": idempotency_key,
                "stdout_tail": (stdout or "")[-800:],
                "stderr_tail": (stderr or "")[-800:],
            }
        try:
            retry_started = time.time()
            retry_stdout, retry_stderr = _run_grok(_build_imagine_prompt(prompt, retry_started, True), timeout)
            stdout = f"{stdout}\n{retry_stdout}".strip()
            stderr = f"{stderr}\n{retry_stderr}".strip()
            retried_after_skip = True
        except FileNotFoundError:
            return {"ok": False, "error": "executável 'grok' não encontrado no PATH"}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"falha ao reexecutar grok após skip: {exc}"}

    # poll pós-execução: a imagem pode levar um instante pra aparecer no disco
    image = None
    deadline = time.time() + 20
    while time.time() < deadline:
        image = _find_new_image(roots, snapshot, started)
        if image:
            break
        time.sleep(1.0)

    if not image:
        return {
            "ok": False,
            "error": "nenhuma imagem nova detectada na sessão do grok",
            "skipped_previous": skipped_previous,
            "force": force,
            "retried_after_skip": retried_after_skip,
            "stdout_tail": (stdout or "")[-800:],
            "stderr_tail": (stderr or "")[-800:],
        }

    try:
        shutil.copyfile(image, dest_resolved)
        size = dest_resolved.stat().st_size
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"falha ao copiar imagem para o destino: {exc}",
                "source_image": str(image)}

    return {
        "ok": True,
        "saved_to": str(dest_resolved),
        "bytes": size,
        "exists": dest_resolved.exists(),
        "source_session_image": str(image),
        "prompt": prompt,
        "force": force,
        "reused": False,
        "retried_after_skip": retried_after_skip,
        "idempotency_key": idempotency_key,
    }


if __name__ == "__main__":
    import json
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    p = sys.argv[1] if len(sys.argv) > 1 else "a simple solid blue circle centered on a white background, minimalist"
    out = sys.argv[2] if len(sys.argv) > 2 else str(TARS_DIR / "workspace" / "grok_imagine_selftest.png")
    print(json.dumps(generate(p, output_path=out), ensure_ascii=False, indent=2))
