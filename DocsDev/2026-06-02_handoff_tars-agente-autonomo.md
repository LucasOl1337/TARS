# Handoff — TARS: de companion a agente autônomo de serviço

> **Sessão:** 2026-06-02, 14:10 (UTC−03 / horário de Brasília)
> **Tema principal:** evolução do TARS de um chatbot/companion para um **runtime de agente autônomo** que executa trabalho real com ferramentas, é operável por um dashboard, e é **usável por outros serviços através do Kamui**. Inclui também uma revisão de qualidade (QA) do catálogo de endpoints do Kamui.
> **Repositório:** `C:\Projetos\TARS` (backend FastAPI em `:62026`, dashboard Vite/React em `:62025`).
> **Para quem continuar:** este documento é a passagem de bastão. Leia as seções "Pendências", "Riscos/Atenção" e "Continuidade" antes de mexer.

---

## 1. Objetivo central

Transformar o TARS num **agente autônomo de propósito geral**: ele recebe (ou inventa) um **objetivo com critério de sucesso**, e age em **loop** (planejar → agir → observar → verificar → repetir) usando ferramentas reais (terminal, arquivos, web, geração de imagem, sub-agentes, chamadas cross-app), até o objetivo ser **verificado** como cumprido — ou o orçamento estourar. Depois, expor isso como **serviço do ecossistema**: outros sistemas pedem trabalho ao TARS **via Kamui** e recebem o resultado de volta.

---

## 2. Estado atual (o que o TARS É hoje)

Arquitetura no `backend/` (FastAPI/Python, porta `62026`, SQLite em `data/tars.db`):

| Módulo | Papel |
|---|---|
| `agent.py` | Loop ReAct (protocolo JSON provider-agnóstico) + **verificador adversarial** separado do executor |
| `goals.py` | Modelo de objetivo (tabelas `goals` + `goal_steps`) com `definition_of_done` e orçamentos (max_iterations/seconds/tool_calls) |
| `governance.py` | Sandbox de paths (`allowed_roots()`), allowlist/denylist de shell, bloqueio de ações irreversíveis, **kill-switch** |
| `memory.py` | Memória durável episódica/semântica (`memories`) + `mission_log` (agora persiste) |
| `heartbeat.py` | Vida proativa (loop em background, começa **desligado**); só enfileira goals, não executa shell direto |
| `tools.py` | Executor unificado `execute_tool` + ferramentas reais (ver §6) |
| `grok_imagine.py` | Geração de imagem dirigindo o `grok` CLI headless (`/imagine`) |
| `server.py` | App FastAPI: monta o router em `/api/tars/*` **e** `/api/kamui/*` (alias) |
| `brain.py` | Compõe system prompt da persona + despacha LLM (GLM/Kimi/Anthropic/OpenRouter) |
| `bridges.py` | Pontes do hub: `yume`, `kamui`, `videogen` + proxy genérico + `echoes` (auditoria) |

**Motor de raciocínio:** `glm-5.1` (GLM) via z.ai (`https://api.z.ai/api/coding/paas/v4`), resolvido em `brain.provider_for_model`. Trocável numa linha (persona.model / `TARS_MODEL`). **Motor de imagem:** Grok Imagine (xAI) via o CLI `grok` — separado.

Dashboard no `dashboard/` (Vite/React/Tailwind, `:62025`, proxy `/api → :62026`, HMR ativo). Tema "Asiimov" (branco-aço sobre vazio). Páginas: Dimension, **Missões** (nova), Endpoints, Ferramentas, Persona, Voz.

---

## 3. O que foi implementado / alterado nesta sessão

### 3.1. Runtime agêntico (6 fases) — `backend/`
- **Fase 0 — Goal & Loop:** `goals.py` + `agent.py` (loop ReAct com teto de iterações/tempo/tool-calls; cada passo gravado em `goal_steps` e como `echo`).
- **Fase 1 — Verificação:** `verify_goal()` em `agent.py` — LLM separado, prompt adversarial ("prove que NÃO concluí"); se reprova, devolve feedback e o loop continua.
- **Fase 2 — Ferramentas reais + governança:** `governance.py` + builtins (shell/fs/web/llm_subcall...).
- **Fase 3 — Memória:** `memory.py`; corrigido o `mission_log` (era no-op, agora persiste).
- **Fase 4 — Heartbeat:** `heartbeat.py` no lifespan (default OFF).
- **Fase 5 — Sub-agentes + Kamui + endpoints REST:** tool `spawn_subagent` (recursão limitada), `kamui_call`, e endpoints `/goals*` no `server.py`.

### 3.2. Capacidade Grok Imagine — `backend/grok_imagine.py` + `ferramentas/grok_imagine.json`
Dirige `grok --cwd <dir> -p "/imagine <prompt>..." --no-subagents --output-format plain` (headless), localiza a imagem nova na pasta de sessão (`~/.grok/sessions/...`) e copia pro destino (default: **Desktop**). Porta do padrão comprovado do usuário em `VideoGen/FLUXO/gerar-imagens/grok-terminal-image-runner.mjs`.

### 3.3. Melhoria de governança — raízes de escrita configuráveis
`governance.allowed_roots()` = workspace + extras de `agent_state['extra_roots']` ou env `TARS_EXTRA_WRITE_ROOTS` (ex: Desktop). Default seguro (só workspace). Destravou trabalhar com entregáveis reais (Desktop) sob governança.

### 3.4. Dashboard — página **Missões** — `dashboard/src/pages/MissionsPage.tsx`
Compositor de missão (objetivo + descrição + `definition_of_done` + presets), lista de missões com status, **trail ao vivo** (raciocínio→ferramenta→observação, polling 1.5s), resultado + veredito do verificador, e painel de **heartbeat + kill-switch**. Registrada em `App.tsx` (case `missions`) e `components/Layout.tsx` (navItem, ícone `Target`, PageId `missions`). Backend de apoio: `POST /api/tars/goals/{id}/start` (roda em background, retorna 202).

### 3.5. API de serviço (inbound/outbound) — `server.py`
- `POST /api/tars/work` — outro serviço **delega trabalho** (`{task, definition_of_done?, callback_url?, budget?, sync?}`) → `202 {job_id, status_url, steps_url}` (assíncrono por padrão; `sync:true` aguarda).
- `GET /api/tars/work/{job_id}` — status/resultado.
- **callback (outbound):** se `callback_url` vier, ao concluir faz `POST {event:"work.completed", job_id, ok, result, verifier}` de volta.
- Token inbound opcional: `config.TARS_INBOUND_TOKEN` (env). Vazio = inbound aberto (confiança local).

### 3.6. Documentação no TARS e no Kamui
- **No TARS:** `GET /api/tars/manifest` — manifesto auto-descritivo (service, access direto+via_kamui, how_to_delegate_work, tools, governança). Módulo `agent` adicionado ao `catalog.py` (página Endpoints).
- **No Kamui:** `C:\projetos\kamui\backend\src\catalog\tars.ts` reescrito com a superfície real (16 outbound + 10 inbound, com `examplePayload`); módulo marcado `featured` em `catalog/index.ts`. Tether `tars` já registrado em `lib/tethers.ts` (baseUrl `:62026`). Proxy `/kamui/tars/api/tars/*` confirmado funcionando.

### 3.7. QA do catálogo do Kamui — `C:\projetos\kamui\backend\scripts\catalog-audit.mjs`
Auditor objetivo (read-only) que valida cada tether **contra o serviço real**: sonda GETs concretos via Kamui, classifica ok/404/inalcançável/erro, checa `examplePayload`/ids/formato, dá nota A–F. Distingue tether proxiado de módulo nativo do Kamui (via `GET /kamui/tethers`).
- **Diagnóstico inicial:** `simple` (F, 0.045 — 21 endpoints fantasma de uma versão antiga), `shikigami` (id duplicado + 1 entry não-Kamui), demais A.
- **Conserto orientado a dados:** `simple.ts` reescrito contra `simple-ai/api/server.py` (builder `/v2/build`, intake `/v1/intake/*`, chat `/v2/chat/turn`, WhatsApp brain, agente OCI...); `shikigami.ts` deduplicado + entry corrigida.
- **Resultado final medido:** **14/14 tethers grade A, 0 endpoints fantasma, 0 erros TypeScript** (`tsc --noEmit`).

---

## 4. Provas executadas nesta sessão (autônomas, verificadas)

| Missão | Resultado |
|---|---|
| Smoke test do runtime | `backend/smoke_test.py` — todos os checks passaram (governança, fs, shell, memória, goal, heartbeat, loop e2e) |
| 1 cavalo + 2 leões via Grok Imagine → Desktop | **done**; 3 JPEGs reais no Desktop (`cavalo.png`, `leao_1.png`, `leao_2.png`) |
| Primos de Fibonacci < 1M (código + rodar) | **done**; output correto verificado independentemente |
| Galeria criativa (2 imagens + index.html) | **done**; `Desktop/TARS-galeria/` |
| Decomposição com 2 sub-agentes + report.md | **done**; 2 goals filhos `depth=1`; soma de primos `454396537` correta |
| **Disparar sandbox2 do VideoGen via Kamui e PUBLICAR vídeo** | **PUBLICADO** no canal "Guess The Song Lab": `https://youtu.be/V2zgH63QoJ4` (autorizado explicitamente pelo usuário) |
| API de serviço (inbound + callback) via Kamui | **OK** (`test_work_api.py`): delegou, executou, entregou no callback; também testado via `/kamui/tars/api/tars/work` |

Scripts de teste/missão criados (em `backend/`): `smoke_test.py`, `mission_grok.py`, `mission_hard.py`, `mission_videogen.py`, `test_work_api.py`. Artefatos no `Desktop/`: `TARS-galeria/`, `TARS-missoes/`, `coruja.png`, imagens dos leões/cavalo.

---

## 5. Como rodar / operar

```powershell
# Subir tudo (backend + dashboard)
C:\Projetos\TARS\start-tars.ps1
# Só backend, liberando a porta (usa a venv) — necessário após mexer no server.py
C:\Projetos\TARS\start-tars.ps1 -BackendOnly -Force
# Parar
C:\Projetos\TARS\stop-tars.ps1

# Smoke test do runtime (não precisa de UI)
C:\Projetos\TARS\backend\.venv\Scripts\python.exe C:\Projetos\TARS\backend\smoke_test.py

# Auditar a qualidade do catálogo do Kamui
cd C:\projetos\kamui ; node backend/scripts/catalog-audit.mjs

# Ligar a vida proativa (heartbeat)
# PUT http://127.0.0.1:62026/api/tars/heartbeat  { "enabled": true, "auto_run": true }
# Parada de emergência:
# POST http://127.0.0.1:62026/api/tars/kill-switch { "engage": true }
```

---

## 6. Ferramentas do agente (18 executáveis) — `backend/ferramentas/*.json`

`think`, `mission_log`, `memory_save`, `memory_recall`, `shell_exec`, `fs_read`, `fs_write`, `fs_list`, `web_search`, `web_fetch`, `llm_subcall`, `spawn_subagent`, `grok_imagine`, `astro_lookup`, `orbital_calc`, `bridge_call`, `kamui_call`, `image_generate`.

(`astro_lookup`/`orbital_calc` são resíduos decorativos do scaffold "espacial" — candidatos a aposentadoria.)

---

## 7. Decisões importantes

- **Acesso via Kamui é o padrão:** outros serviços alcançam o TARS por `/kamui/tars/api/tars/*` (o Kamui enveloparia a resposta em `{ok, tether, status, data}` — desembrulhe `data`). Princípio §3.4/§3.6 do `global_truth.md` do Kamui.
- **Catálogo é fonte de verdade única** (`global_truth.md §3.4`): editar `backend/src/catalog/<tether>.ts`, nunca duplicar.
- **Governança conservadora por padrão:** destrutivos sempre bloqueados; irreversíveis bloqueados a menos de `TARS_ALLOW_IRREVERSIBLE`; heartbeat começa OFF.
- **Publicação do vídeo no YouTube** foi autorizada explicitamente pelo usuário (ação pública/irreversível) — só foi feita após confirmação.

---

## 8. Pendências / próximos passos recomendados

1. **`kamui doctor` gate:** plugar o `catalog-audit.mjs` no `kamui doctor` pra travar regressões de catálogo (sugerido, não feito).
2. **VideoGen — 2 endpoints com erro de runtime** (não é erro de catálogo): `vid-dashboard-state` (500 — precisa `?key=`) e `vid-el-voices` (502 — ElevenLabs upstream). Documentar o `?key=` e/ou marcar dependência de upstream.
3. **Padrão de manifesto unificado (opcional):** cada tether expor um `/manifest` no formato do TARS e o Kamui agregar em `/kamui/manifest` — evolução natural do índice de descoberta.
4. **Dashboard:** opções sugeridas e não feitas — "repetir missão", filtro por status, e definir Missões como tela inicial.
5. **Persistência do build do Kamui:** as edições no catálogo do Kamui estão em TS e foram validadas com `tsc --noEmit`; o Kamui roda `tsx watch` (live). Garantir que o processo de produção/build do Kamui seja reiniciado/buildado quando for promovido.
6. **Aposentar tools decorativas** (`astro_lookup`, `orbital_calc`) se o tema espacial não for proposital.
7. **Teste prático do usuário** estava planejado para a página Missões — validar UX.

---

## 9. Riscos, bugs e pontos de atenção ⚠️

- **`grok_imagine` salva bytes JPEG sob nome `.png`** (o grok entrega JPEG mesmo quando o filename é `.png`). Abre normal, mas é mismatch cosmético. Corrigir: honrar a extensão de origem ou reencodar.
- **Ações cross-app via `kamui_call` NÃO passam pela governança de irreversibilidade do TARS.** A governança (allowlist/irreversível/kill-switch) cobre o **shell/fs do próprio TARS**, não o que um endpoint de outro serviço faz a jusante. Foi assim que a publicação do vídeo ocorreu (o pipeline `sandbox2` injeta `confirmPublicUpload: true` internamente; o TARS só passou `targetChannelId`). **Atenção:** delegar trabalho que aciona endpoints externos pode disparar ações irreversíveis sem o gate local. Avaliar um gate por allowlist de endpoints/bridges sensíveis.
- **`TARS_INBOUND_TOKEN` está vazio** = inbound aberto. OK em localhost; **risco se exposto** além da máquina. Setar o token antes de qualquer exposição de rede.
- **`web_search` é best-effort** via HTML do DuckDuckGo — frágil, pode quebrar se o HTML mudar. Plugar um provedor real se virar crítico.
- **Heartbeat `auto_run` default = ON** (mas `enabled` = OFF). Se ligar `enabled`, ele roda goals pendentes automaticamente. Tenha isso em mente ao ligar.
- **Pasta `CORVO/` dentro do TARS é uma duplicata** do projeto (backend+dashboard). A versão **viva é a da raiz** (`backend/`, `dashboard/`). Não editar `CORVO/` por engano.
- **Python do backend:** o processo estava rodando com o **Python do sistema** (Python311) antes; foi reiniciado com a **venv** (`backend/.venv`) via `start-tars.ps1`. Use sempre a venv (tem as deps: fastapi, uvicorn, httpx, dotenv, faster-whisper...).
- **Latência de imagem:** `grok_imagine` leva ~30–90s por imagem; missões com várias imagens precisam de `max_seconds` generoso no orçamento.
- **Catálogo do Kamui em `C:\projetos\kamui`** (minúsculo) — repositório **separado** do TARS. Edições lá afetam todo o ecossistema; rode o auditor após qualquer mudança.

---

## 10. Informações para continuidade (contexto que não está no código)

- **Memória do projeto (registro mais rico):** `C:\Users\user\.claude\projects\C--Projetos-TARS\memory\` — arquivos: `tars-agentic-runtime.md`, `tars-grok-imagine.md`, `tars-dashboard-missions.md`, `tars-service-api.md`, `kamui-catalog-qa.md`, `tars-voice-omnivoice.md` (índice em `MEMORY.md`). **Estão fora do repo** (home do usuário) — futuros agentes que só olharem o repo não os verão; este handoff consolida o essencial.
- **Portas do ecossistema:** TARS `62026` (api) / `62025` (dashboard); Kamui `1338`; VideoGen `4197`; Yume `2223`; Simple `1056`; OmniVoice `3920`; etc. (registro canônico em `kamui/backend/src/lib/tethers.ts`).
- **Providers LLM configurados:** GLM (z.ai) e Kimi têm chave; Anthropic e OpenRouter não. Modelo ativo: `glm-5.1`.
- **Grok CLI:** `~/.grok/bin/grok.exe` (autenticado); `/imagine` é slash-command nativo (o MCP `codex-image-generator` está quebrado e é irrelevante).
- **README do projeto:** `C:\Projetos\TARS\README.md` (overview-raiz; mantido na raiz por convenção).

---

## 11. Resumo de uma linha

O TARS hoje **recebe trabalho de outros serviços via Kamui, executa de forma autônoma com ferramentas reais (incl. publicar vídeo no YouTube via VideoGen), verifica o resultado, entrega de volta, é operável por um dashboard e está documentado/descoberto no índice canônico do Kamui** — com um auditor que garante a qualidade desse catálogo (14/14 grade A).
