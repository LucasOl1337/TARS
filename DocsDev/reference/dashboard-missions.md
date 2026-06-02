# Dashboard — página Missões

O dashboard do TARS (`dashboard/`, Vite+React+Tailwind+framer-motion, roda em :62025 com proxy `/api`→:62026, HMR ativo) tem a página **Missões** — o reflexo de produto do runtime agêntico, replicável pra qualquer tarefa.

- **Arquivo:** `dashboard/src/pages/MissionsPage.tsx`. Registrada em `App.tsx` (case `missions`) e `components/Layout.tsx` (navItem 'Missões', ícone `Target`, PageId `missions`).
- **Componentes:** compositor de missão (objetivo + descrição + `definition_of_done` + chips de preset → cria goal com `run:false` e dispara `/start`); lista de missões com status; **trail ao vivo** (passos plan/act/verify/finish expansíveis com thought/tool_input/observation, polling 1.5s enquanto running/verifying/pending); resultado + veredito do verificador; painel de **heartbeat** (toggles ligado/auto-run/propõe) + **kill-switch**.
- **API consumida:** `GET/POST /api/tars/goals`, `/goals/{id}`, `/goals/{id}/steps`, `/goals/{id}/cancel`, `GET/PUT /api/tars/heartbeat`, `POST /api/tars/kill-switch`.
- **Backend de apoio:** `POST /api/tars/goals/{id}/start` — roda o goal em background (`asyncio.create_task`) e retorna 202, pra UI assistir ao vivo sem bloquear.
- **Reiniciar o backend pra servir rotas novas:** `.\start-tars.ps1 -BackendOnly -Force` (usa a venv). O dashboard recarrega sozinho (HMR).

Tema "Asiimov" (branco-aço sobre vazio), classes utilitárias `void-panel`/`void-title`/`btn-rift`. Verificado por screenshot em 2026-06-02.
