# TARS — space exploration companion

Uma IA de bordo com **comportamento próprio** + **ferramentas modulares**, que
também funciona como **hub**: faz pontes ("bridges") para os outros projetos do
ecossistema (**Yume** e **Kamui**).

Fusão de duas arquiteturas:
- **inteligência** no estilo do **Yume** — persona/comportamento, system prompt
  composto por blocos, catálogo de tools em JSON, chat multi-provider (GLM /
  Kimi / Anthropic / OpenRouter);
- **hub** no estilo do **Kamui** — proxy genérico por ponte, log de "echoes",
  health por polling, mapa de portas.

Visual: o dashboard é uma cópia do front do Kamui, **re-tematizado** do vermelho
Sharingan para o **branco "Asiimov"** — tons técnicos de branco e cinza-aço
sobre vazio espacial, com o motivo de marca trocado (monolito orbital no lugar
do olho).

## Portas

| Componente        | Porta  | URL                                   |
|-------------------|--------|---------------------------------------|
| Backend (FastAPI) | 62026  | http://127.0.0.1:62026/api/tars/      |
| Dashboard (Vite)  | 62025  | http://127.0.0.1:62025/               |
| Ponte → Yume      | 2223   | http://127.0.0.1:2223 (externo)       |
| Ponte → Kamui     | 1338   | http://127.0.0.1:1338 (externo)       |

## Subir

```powershell
.\start-tars.ps1            # backend + dashboard, abre o navegador
.\start-tars.ps1 -Force     # libera as portas antes (mata supervisores)
.\start-tars.ps1 -BackendOnly
.\stop-tars.ps1             # derruba tudo
```

Manualmente:
```powershell
# backend
cd backend; .\.venv\Scripts\python.exe server.py
# dashboard (noutra janela)
cd dashboard; npm run dev
```

## Estrutura

```
backend/
  config.py     paths, portas, chaves de LLM, URLs das pontes
  db.py         SQLite: personas + echoes + bridge_health; persona TARS default
  bridges.py    registro das pontes (Yume/Kamui) + call_bridge + health poll
  tools.py      loader de ferramentas/*.json + executores builtin (espaço)
  brain.py      composição do system prompt + dispatch de LLM
  ports.py      mapa de portas via netstat
  catalog.py    catálogo de endpoints (página Endpoints)
  server.py     app FastAPI — rotas /api/tars/* (+ alias /api/kamui/* p/ compat)
ferramentas/    think, mission_log, astro_lookup, orbital_calc, bridge_call
dashboard/      front React/Vite re-tematizado (Asiimov white)
```

## API (resumo)

- `GET  /api/tars/health` — status do hub + inteligência
- `GET/PUT /api/tars/persona` — comportamento do TARS
- `GET  /api/tars/system-prompt` — prompt composto
- `POST /api/tars/chat` — conversa (invoca LLM)
- `GET  /api/tars/chat/providers` — providers disponíveis
- `GET  /api/tars/tools` · `POST /api/tars/tools/{id}/invoke`
- `GET  /api/tars/bridges` · `GET /api/tars/bridges/status`
- `GET  /api/tars/echoes` (+ `/summary`, `/flows`)
- `GET  /api/tars/endpoints` — catálogo do dashboard
- `GET  /api/tars/ports`
- `*    /api/tars/bridge/{bridge_id}/{path}` — proxy genérico das pontes

> Nota: o dashboard foi copiado do Kamui; por isso o backend também responde em
> `/api/kamui/*` (mesmo router) para as páginas funcionarem sem reescrita total.

## LLM

As chaves vêm do ambiente (nunca hardcoded): `GLM_API_KEY`, `OPENROUTER_API_KEY`,
`ANTHROPIC_API_KEY`, `KIMI_API_KEY`. Sem chave, todo o resto funciona — só o
`/chat` retorna 503. Modelo default: `glm-5.1`.

## Voz (TTS via OmniVoice)

A fala do TARS sai com **voz clonada do OmniVoice** (serviço local de TTS),
alcançado pela ponte `omnivoice` do Kamui — não pelo TTS robótico do navegador.
O front (`/voice/...`) tenta o OmniVoice primeiro e cai pro `SpeechSynthesis`
local só se o serviço estiver fora, então a voz nunca "some".

- `GET  /api/tars/voice/voices` — catálogo de vozes clonadas (via ponte)
- `POST /api/tars/voice/tts` — texto → áudio (MP3) com a voz selecionada
- `POST /api/tars/voice/prewarm` — aquece o worker (mata o cold-start de ~60s)

Config por ambiente: `TARS_VOICE_TTS_VOICE` (default `draven`),
`TARS_VOICE_TTS_FORMAT` (`mp3`), `TARS_VOICE_TTS_SPEED` (`0.98`).
