"""TARS backend — configuração central.

TARS é um *space exploration companion*: uma inteligência conversacional com
ferramentas modulares (catálogo em ../ferramentas/*.json) e comportamento
próprio, que também funciona como HUB — faz pontes ("bridges") para os outros
projetos do ecossistema (Yume = registry de personas/cérebro, Kamui = hub de
inteligência cross-dimensional).

Stack: FastAPI + SQLite (sqlite3 nativo, sem ORM) + httpx.
Porta canônica: 62026.
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

from dotenv import load_dotenv

# Carrega .env do backend (suporta chaves do VideoGen também)
load_dotenv(dotenv_path=Path(__file__).parent / ".env")

# ----- Paths ---------------------------------------------------------------

BACKEND_DIR = Path(__file__).resolve().parent
TARS_DIR = BACKEND_DIR.parent
DATA_DIR = TARS_DIR / "data"
DB_PATH = DATA_DIR / "tars.db"
TOOLS_DIR = TARS_DIR / "ferramentas"

DATA_DIR.mkdir(parents=True, exist_ok=True)
TOOLS_DIR.mkdir(parents=True, exist_ok=True)

# ----- Server --------------------------------------------------------------

SERVER_HOST = "127.0.0.1"
SERVER_PORT = int(os.environ.get("TARS_BACKEND_PORT", "62026"))
DASHBOARD_PORT = int(os.environ.get("TARS_DASHBOARD_PORT", "62025"))
DASHBOARD_ORIGIN = os.environ.get(
    "TARS_DASHBOARD_ORIGIN", f"http://127.0.0.1:{DASHBOARD_PORT}"
)

# ----- Bridges (pontes p/ outros projetos) ---------------------------------
# O HUB do TARS alcança esses serviços. O proxy genérico expõe cada um em
# /api/tars/bridge/<id>/*. Health é monitorado por polling.

YUME_URL = os.environ.get("YUME_URL", "http://127.0.0.1:2223").rstrip("/")
KAMUI_URL = os.environ.get("KAMUI_URL", "http://127.0.0.1:1338").rstrip("/")
VIDEOGEN_URL = os.environ.get("VIDEOGEN_URL", "http://127.0.0.1:4197").rstrip("/")

# ----- LLM providers (cérebro) ---------------------------------------------
# Mesma resolução do Yume: glm / kimi / anthropic / openrouter.
# Suporta chaves vindas do ambiente do VideoGen (VIDEOGEN_GLM_API_KEY etc).

def _get_key(name: str, fallback_names: list[str] = None) -> str:
    val = os.environ.get(name, "").strip()
    if val:
        return val
    if fallback_names:
        for fn in fallback_names:
            v = os.environ.get(fn, "").strip()
            if v:
                return v
    return ""

OPENROUTER_API_KEY = _get_key("OPENROUTER_API_KEY")
OPENROUTER_BASE = os.environ.get("OPENROUTER_BASE", "https://openrouter.ai/api/v1").rstrip("/")

ANTHROPIC_API_KEY = _get_key("ANTHROPIC_API_KEY")
ANTHROPIC_BASE = os.environ.get("ANTHROPIC_BASE", "https://api.anthropic.com/v1").rstrip("/")

GLM_API_KEY = _get_key("GLM_API_KEY", ["VIDEOGEN_GLM_API_KEY"])
GLM_BASE = os.environ.get("GLM_BASE", os.environ.get("VIDEOGEN_GLM_API_BASE_URL", "https://api.z.ai/api/coding/paas/v4")).rstrip("/")

KIMI_API_KEY = _get_key("KIMI_API_KEY", ["MOONSHOT_API_KEY"])
KIMI_BASE = os.environ.get("KIMI_BASE", os.environ.get("MOONSHOT_BASE", "https://api.kimi.com/coding/v1")).rstrip("/")

# Modelo default da inteligência TARS (pode ser glm-5.1 via z.ai)
TARS_MODEL = os.environ.get("TARS_MODEL", os.environ.get("VIDEOGEN_GLM_MODEL", "glm-5.1")).strip()
TARS_TEMPERATURE = float(os.environ.get("TARS_TEMPERATURE", "0.7"))
TARS_MAX_TOKENS = int(os.environ.get("TARS_MAX_TOKENS", "8000"))

# Voice detector tuning
VOICE_JUDGE_TEMPERATURE = float(os.environ.get("VOICE_JUDGE_TEMPERATURE", "0.6"))
VOICE_JUDGE_MAX_TOKENS = int(os.environ.get("VOICE_JUDGE_MAX_TOKENS", "1400"))
VOICE_AGGRESSIVENESS = float(os.environ.get("VOICE_AGGRESSIVENESS", "0.65"))

# ----- TTS via OmniVoice (pela ponte Kamui) --------------------------------
# A fala do TARS sai com voz clonada do OmniVoice em vez do TTS robótico do
# navegador. O OmniVoice NÃO é uma ponte direta do TARS — é um tether do Kamui.
# Então alcançamos via a ponte "kamui", sob o prefixo /kamui/omnivoice.
# Endpoint OpenAI-compat: POST /v1/audio/speech {input, voice, response_format}.
VOICE_TTS_BRIDGE = os.environ.get("TARS_VOICE_TTS_BRIDGE", "kamui").strip()
VOICE_TTS_PREFIX = os.environ.get("TARS_VOICE_TTS_PREFIX", "/kamui/omnivoice").rstrip("/")
VOICE_TTS_VOICE = os.environ.get("TARS_VOICE_TTS_VOICE", "draven").strip()
VOICE_TTS_FORMAT = os.environ.get("TARS_VOICE_TTS_FORMAT", "mp3").strip()
VOICE_TTS_SPEED = float(os.environ.get("TARS_VOICE_TTS_SPEED", "0.98"))

# Binário opcional (varredura de portas usa netstat embutido do Windows).
NETSTAT_BIN = os.environ.get("TARS_NETSTAT_BIN", shutil.which("netstat") or "netstat")

# ----- API de serviço (inbound de outros serviços) -------------------------
# Token opcional pra proteger os endpoints de delegação de trabalho (/work,
# criação de goals). Se vazio, o inbound é aberto (confiança local). Se setado,
# o chamador precisa mandar Authorization: Bearer <token> ou X-TARS-Token.
TARS_INBOUND_TOKEN = os.environ.get("TARS_INBOUND_TOKEN", "").strip()
