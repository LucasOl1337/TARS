# TARS

TARS é um runtime local de agente autônomo com dashboard operacional. Ele combina uma inteligência conversacional com persona própria, ferramentas modulares em JSON, memória persistente, execução de goals, voz/STT/TTS e pontes para outros serviços do ecossistema.

O projeto roda como três blocos principais:

- `backend/`: API FastAPI, agente, memória, goals, harness, voz, STT, catálogo de ferramentas e proxy de bridges.
- `dashboard/`: painel React/Vite para operar o TARS em tempo real.
- `site/`: landing page React/Vite separada para apresentação pública do projeto.

## Dependências Rápidas

- Sistema:
  - Windows + PowerShell.
  - Git.
  - Python 3.11+; testado com `Python 3.11.9`.
  - Node.js 20+ e npm; testado com `Node v24.14.0` e `npm 11.9.0`.
- Backend Python (`backend/requirements.txt`):
  - `fastapi==0.115.0`
  - `uvicorn[standard]==0.30.6`
  - `httpx==0.27.2`
  - `python-dotenv==1.0.1`
  - `python-multipart==0.0.20`
  - `faster-whisper==1.2.1`
  - `nvidia-cublas-cu12==12.9.2.10` opcional para STT com GPU.
  - `nvidia-cudnn-cu12==9.23.0.39` opcional para STT com GPU.
- Dashboard npm (`dashboard/package.json`):
  - `react@^19.0.0`
  - `react-dom@^19.0.0`
  - `vite@^6.0.0`
  - `typescript@^5.7.0`
  - `@vitejs/plugin-react@^4.3.0`
  - `three@^0.184.0`
  - `@types/three@^0.184.1`
  - `lucide-react@^0.460.0`
  - `framer-motion@^12.0.0`
  - `tailwindcss@^3.4.17`
  - `postcss@^8.5.0`
  - `autoprefixer@^10.4.20`
  - `@types/react@^19.0.0`
  - `@types/react-dom@^19.0.0`
- Landing npm (`site/package.json`):
  - `react@^19.0.0`
  - `react-dom@^19.0.0`
  - `vite@^6.0.7`
  - `typescript@^5.7.2`
  - `@vitejs/plugin-react@^4.3.4`
  - `three@^0.184.0`
  - `@types/three@^0.184.0`
  - `lucide-react@^0.460.0`
  - `@types/react@^19.0.8`
  - `@types/react-dom@^19.0.3`
- Serviços externos opcionais:
  - Yume em `http://127.0.0.1:2223`.
  - Kamui em `http://127.0.0.1:1338`.
  - VideoGen em `http://127.0.0.1:4197`.
  - 9Router/OpenAI-compatible em `http://127.0.0.1:20128/v1`.
  - OmniVoice via ponte do Kamui para TTS clonado.
- Variáveis de ambiente opcionais:
  - `GLM_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `KIMI_API_KEY`.
  - `TARS_MODEL`, `TARS_TEMPERATURE`, `TARS_MAX_TOKENS`.
  - `NINEROUTER_BASE`, `NINEROUTER_API_KEY`, `NINEROUTER_MODEL`.
  - `YUME_URL`, `KAMUI_URL`, `VIDEOGEN_URL`.
  - `TARS_BACKEND_PORT`, `TARS_DASHBOARD_PORT`, `TARS_DASHBOARD_ORIGIN`.
  - `TARS_VOICE_TTS_VOICE`, `TARS_VOICE_TTS_FORMAT`, `TARS_VOICE_TTS_SPEED`.
  - `TARS_INBOUND_TOKEN` para proteger endpoints inbound de trabalho.

## Portas

| Componente | Porta | URL |
|---|---:|---|
| Backend FastAPI | 62026 | `http://127.0.0.1:62026/api/tars/health` |
| Dashboard Vite | 62025 | `http://127.0.0.1:62025/` |
| Landing dev | 62027 | `http://127.0.0.1:62027/` |
| Landing preview | 62028 | `http://127.0.0.1:62028/` |
| Yume opcional | 2223 | `http://127.0.0.1:2223` |
| Kamui opcional | 1338 | `http://127.0.0.1:1338` |
| VideoGen opcional | 4197 | `http://127.0.0.1:4197` |

## Como Rodar

O caminho recomendado sobe backend e dashboard. O script cria a venv do backend e instala as dependências Python se ela ainda não existir; também instala as dependências do dashboard se `node_modules` não existir.

```powershell
.\start-tars.ps1
```

Opções úteis:

```powershell
.\start-tars.ps1 -Force       # libera as portas 62025/62026 antes de subir
.\start-tars.ps1 -BackendOnly # sobe apenas a API
.\start-tars.ps1 -NoBrowser   # não abre navegador automaticamente
.\stop-tars.ps1               # para backend e dashboard
```

Execução manual:

```powershell
# backend
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe server.py
```

```powershell
# dashboard
cd dashboard
npm install
npm run dev
```

```powershell
# landing page
cd site
npm install
npm run dev
```

## Configuração

- O backend carrega `backend/.env`.
- Use `backend/.env.example` como base.
- Sem chave de LLM, o backend, dashboard, memória, ferramentas e bridges continuam operando; o chat real retorna indisponível.
- O banco SQLite fica em `data/tars.db` e é ignorado pelo Git.
- Ferramentas ficam em `ferramentas/*.json` e são carregadas pelo backend.
- Logs de runtime ficam em `logs/`.

## Funcionalidades

- Persona TARS com system prompt composto.
- Chat multi-provider: GLM, 9Router, Kimi, Anthropic e OpenRouter.
- Runtime agêntico com goals, steps, heartbeat e kill-switch.
- Memória persistente e mission log.
- Catálogo de ferramentas locais: leitura/escrita, shell governado, memória, bridge calls, cálculos orbitais, busca/fetch web, subchamadas LLM e geração de assets.
- Bridges para Yume, Kamui e VideoGen com health polling e proxy genérico.
- Event store e echoes para observabilidade.
- Voz com decisor de presença, STT via faster-whisper e TTS via OmniVoice/Kamui.
- Harness de testes com fluxos, componentes e execução via API/dashboard.
- Dashboard com páginas de runtime, engines, tools, missions, voice, persona, endpoints e harness.
- Landing page em `site/` com assets públicos do TARS.

## API Principal

Todas as rotas canônicas ficam em `/api/tars/*`. O backend também monta aliases em `/api/kamui/*` para compatibilidade com telas herdadas.

- `GET /api/tars/health`
- `GET|PUT /api/tars/persona`
- `GET /api/tars/system-prompt`
- `POST /api/tars/chat`
- `GET /api/tars/chat/providers`
- `GET /api/tars/chat/models`
- `GET /api/tars/tools`
- `POST /api/tars/tools/{tool_id}/invoke`
- `GET|POST /api/tars/goals`
- `POST /api/tars/goals/{goal_id}/run`
- `POST /api/tars/work`
- `GET|PUT /api/tars/heartbeat`
- `POST /api/tars/kill-switch`
- `GET /api/tars/memory`
- `GET /api/tars/mission-log`
- `POST /api/tars/voice/judge`
- `POST /api/tars/voice/stt`
- `GET /api/tars/voice/voices`
- `POST /api/tars/voice/tts`
- `POST /api/tars/harness/execute`
- `GET|POST /api/tars/harness/flows`
- `GET /api/tars/harness/components`
- `GET /api/tars/bridges`
- `GET /api/tars/bridges/status`
- `GET /api/tars/endpoints`
- `GET /api/tars/events`
- `GET /api/tars/echoes`
- `GET /api/tars/ports`
- `POST /api/tars/ports/{port}/free`
- `GET /api/tars/services`

## Testes e Verificação

```powershell
# API no ar
Invoke-RestMethod http://127.0.0.1:62026/api/tars/health

# smoke test local do runtime agêntico
backend\.venv\Scripts\python.exe backend\smoke_test.py

# harness completo
backend\.venv\Scripts\python.exe backend\test_harness.py --stress 3

# build do dashboard
cd dashboard
npm run build

# build da landing
cd site
npm run build
```

## Estrutura

```text
backend/
  server.py          API FastAPI e rotas /api/tars/*
  agent.py           loop agêntico
  brain.py           providers LLM e dispatch
  config.py          paths, portas, env vars e chaves
  db.py              SQLite e persona default
  event_store.py     eventos operacionais
  goals.py           objetivos e steps
  tools.py           loader/executor de ferramentas
  bridges.py         Yume, Kamui, VideoGen e proxy
  voice.py           decisor de presença de voz
  stt.py             transcrição via faster-whisper
  harness/           componentes e fluxos de teste

dashboard/
  src/               painel React/Vite

site/
  src/               landing React/Vite
  public/assets/     assets públicos da marca

ferramentas/         manifestos JSON de tools
data/                dados persistentes e fluxos
DocsDev/             documentação técnica auxiliar
logs/                logs de execução local
output/              evidências e screenshots gerados
workspace/           área de trabalho sandbox do agente
```

## Notas

- `CORVO/`, `workspace/`, bancos SQLite, logs e builds são ignorados pelo Git.
- `output/` contém evidências geradas por testes e pode crescer.
- Para mudar portas, ajuste `TARS_BACKEND_PORT` e `TARS_DASHBOARD_PORT`.
- Para STT só em CPU, remova as dependências CUDA do `backend/requirements.txt` antes de instalar.
