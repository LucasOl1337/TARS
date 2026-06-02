"""STT — Speech-to-Text module for TARS voice presence.

Uses faster-whisper (CTranslate2-based Whisper) for local, offline speech recognition.
Replaces the browser's webkitSpeechRecognition which requires Google servers.

The module loads a small Whisper model (tiny or base) on first use and provides
a simple transcribe() function that accepts audio bytes (WebM/OPUS or WAV).
"""
from __future__ import annotations

import io
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

log = logging.getLogger("tars.stt")

_model = None
_model_size = os.environ.get("TARS_STT_MODEL", "base")
# GPU por padrão (CTranslate2 + CUDA). Cai pra CPU sozinho se faltar lib/GPU.
_device = os.environ.get("TARS_STT_DEVICE", "cuda").strip().lower()
# float16 é o compute ideal na GPU; int8 na CPU. Override via TARS_STT_COMPUTE.
_compute_type = os.environ.get(
    "TARS_STT_COMPUTE", "float16" if _device == "cuda" else "int8"
).strip()
# qual device/compute realmente está em uso após o load (pode cair pra cpu)
active_device = _device
active_compute = _compute_type


def _register_cuda_dll_dirs() -> None:
    """No Windows, as DLLs do CUDA vêm dos pacotes pip ``nvidia-*`` mas não
    entram no PATH sozinhas. Registramos os bin/ via os.add_dll_directory para
    o CTranslate2 achar cublas64_12.dll / cudnn*.dll (senão a transcrição quebra
    com "Library cublas64_12.dll is not found")."""
    if os.name != "nt":
        return
    import importlib.util
    for pkg in ("nvidia.cublas", "nvidia.cudnn", "nvidia.cuda_nvrtc"):
        try:
            spec = importlib.util.find_spec(pkg)
            if not spec or not spec.submodule_search_locations:
                continue
            bindir = Path(list(spec.submodule_search_locations)[0]) / "bin"
            if not bindir.is_dir():
                continue
            # add_dll_directory ajuda quem usa LOAD_LIBRARY_SEARCH_USER_DIRS,
            # mas o CTranslate2 carrega cublas/cudnn com LoadLibrary simples, que
            # busca no PATH — então prependemos ao PATH também (essencial).
            os.add_dll_directory(str(bindir))
            if str(bindir) not in os.environ.get("PATH", ""):
                os.environ["PATH"] = str(bindir) + os.pathsep + os.environ.get("PATH", "")
            log.info(f"CUDA DLL dir registrado: {bindir}")
        except Exception as e:
            log.warning(f"Falha ao registrar DLL dir de {pkg}: {e}")


def _try_load(model_size: str, device: str, compute: str):
    """Carrega o modelo e faz um warmup real para validar o backend — o erro de
    cublas/cudnn na GPU só aparece ao transcrever, não no load."""
    from faster_whisper import WhisperModel
    import numpy as np
    log.info(f"Loading Whisper '{model_size}' on {device}/{compute}...")
    m = WhisperModel(
        model_size, device=device, compute_type=compute,
        download_root=str(Path(__file__).parent / ".whisper_cache"),
    )
    # warmup: 0.5s de silêncio força a init do backend (e pega o erro de DLL aqui)
    list(m.transcribe(np.zeros(8000, dtype="float32"), language="pt", beam_size=1)[0])
    return m


def _get_model():
    """Lazy-loads the Whisper model on first call. Tenta GPU e cai pra CPU se a
    GPU não estiver utilizável (driver/lib ausente), sem derrubar o serviço."""
    global _model, active_device, active_compute
    if _model is not None:
        return _model

    attempts = [(_device, _compute_type)]
    if _device == "cuda":
        _register_cuda_dll_dirs()
        attempts.append(("cpu", "int8"))  # fallback se a GPU falhar

    last_err = None
    for device, compute in attempts:
        try:
            _model = _try_load(_model_size, device, compute)
            active_device, active_compute = device, compute
            log.info(f"Whisper pronto em {device}/{compute}.")
            return _model
        except Exception as e:
            last_err = e
            log.error(f"Falha ao carregar Whisper em {device}/{compute}: {e}")
            if device == "cuda":
                log.warning("GPU indisponível para o Whisper — caindo para CPU.")
    raise last_err


def transcribe(audio_bytes: bytes, language: str = "pt") -> dict[str, Any]:
    """
    Transcribe audio bytes to text.

    Args:
        audio_bytes: Raw audio data (WebM/OPUS, WAV, etc.)
        language: Language code (default: "pt" for Portuguese)

    Returns:
        {"text": str, "language": str, "segments": list, "duration": float}
    """
    model = _get_model()

    # Write to temp file — faster-whisper handles decoding via ffmpeg/av
    suffix = ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(audio_bytes)
        tmp_path = f.name

    try:
        segments_iter, info = model.transcribe(
            tmp_path,
            language=language,
            beam_size=1,          # Fastest setting for real-time
            best_of=1,
            temperature=0.0,
            condition_on_previous_text=False,
            vad_filter=True,      # Built-in VAD to skip silence
            vad_parameters=dict(
                min_silence_duration_ms=300,
                speech_pad_ms=200,
            ),
        )

        segments = list(segments_iter)
        text = " ".join(s.text.strip() for s in segments if s.text.strip())
        duration = info.duration if hasattr(info, "duration") else 0.0

        return {
            "text": text,
            "language": info.language if hasattr(info, "language") else language,
            "segments": [
                {"start": s.start, "end": s.end, "text": s.text.strip()}
                for s in segments
            ],
            "duration": duration,
        }
    except Exception as e:
        log.error(f"Transcription error: {e}")
        return {"text": "", "language": language, "segments": [], "duration": 0.0, "error": str(e)}
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def stt_info() -> dict[str, Any]:
    """Estado do STT: o que foi pedido e o que está de fato em uso (a GPU pode
    ter caído pra CPU). 'loaded' indica se o modelo já foi carregado."""
    return {
        "model": _model_size,
        "requested_device": _device,
        "requested_compute": _compute_type,
        "active_device": active_device,
        "active_compute": active_compute,
        "loaded": _model is not None,
    }
