# Runtime agêntico do TARS

O TARS evoluiu de chat single-shot para **runtime de agente autônomo** (backend FastAPI, porta 62026), em 6 fases. Núcleo:

- **`backend/goals.py`** — modelo de objetivo no SQLite (`goals` + `goal_steps`), com `definition_of_done` e orçamentos (`max_iterations`/`max_seconds`/`max_tool_calls`).
- **`backend/agent.py`** — loop ReAct provider-agnóstico. Protocolo JSON por turno: `{thought, action: "tool"|"finish", tool_id, input, final_answer}`. `run_goal(goal_id)`. Verificador adversarial **separado** do executor (`verify_goal`) — "prove que NÃO concluí". Quem executa não é quem aprova.
- **`backend/governance.py`** — sandbox de paths via `allowed_roots()` (workspace + raízes extras de `agent_state['extra_roots']` ou env `TARS_EXTRA_WRITE_ROOTS`, ex: Desktop); allowlist/denylist de shell; bloqueio de ações irreversíveis por padrão (`TARS_ALLOW_IRREVERSIBLE` libera); kill-switch persistido.
- **`backend/tools.py`** — executor unificado `execute_tool` (builtin sync via threadpool + builtin async + bridge, tudo logado em `echoes`). Tools reais: `shell_exec`, `fs_read/write/list`, `web_fetch`, `web_search` (DuckDuckGo best-effort), `llm_subcall`, `memory_save/recall`, `spawn_subagent`, `kamui_call`, `grok_imagine`. `mission_log` agora PERSISTE.
- **`backend/memory.py`** — memória episódica/semântica (`memories`) + mission_log; busca keyword+recência+importância; `context_block()` injeta no prompt do agente.
- **`backend/heartbeat.py`** — loop de fundo no lifespan, começa **DESLIGADO**. Liga via `PUT /api/tars/heartbeat`. Juiz proativo só ENFILEIRA goals (origin=heartbeat), nunca executa shell direto. Serializado (1 goal por vez).

**Motor de raciocínio:** `glm-5.1` (GLM via z.ai), resolvido em `brain.provider_for_model`. Trocável via `persona.model` / `TARS_MODEL`. O loop usa temperatura 0.2 (planejador) e 0.1 (verificador).

**Endpoints** sob `/api/tars`: `POST/GET /goals`, `GET /goals/{id}`, `/goals/{id}/steps`, `/goals/{id}/run`, `/goals/{id}/start` (background/202), `/goals/{id}/cancel`, `GET/PUT /heartbeat`, `POST /kill-switch`, `GET /memory`, `/mission-log`.

**Prova:** `backend/.venv/Scripts/python.exe backend/smoke_test.py`. Missões difíceis validadas em `backend/mission_hard.py` (coding+auto-correção, galeria, sub-agentes). Ver também o handoff de 2026-06-02.
