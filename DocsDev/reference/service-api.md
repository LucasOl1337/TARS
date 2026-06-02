# API de serviço do TARS (inbound / outbound)

O TARS é um SERVIÇO do ecossistema: outros serviços (via Kamui em `/kamui/tars/...` ou direto em :62026) podem delegar trabalho a ele.

- **Inbound** `POST /api/tars/work` — body `{task|title, description?, definition_of_done?, budget?, callback_url?, sync?}`. Default assíncrono: cria um goal (origin='service'), roda em background, retorna `202 {job_id, status_url, steps_url}`. Com `sync:true`, aguarda e devolve o resultado.
- **Status** `GET /api/tars/work/{job_id}` — `{job_id, status, done, ok, result, verifier, ...}`.
- **Outbound (entrega)** — se `callback_url` vier no request, ao concluir o TARS faz `POST {event:"work.completed", job_id, status, ok, result, verifier, ...}` pra essa URL.
- **Auth opcional** — `config.TARS_INBOUND_TOKEN` (env `TARS_INBOUND_TOKEN`); se setado, `/work` exige `Authorization: Bearer <token>` ou header `X-TARS-Token`. Vazio = inbound aberto (confiança local).
- Implementação em `server.py` (`submit_work`, `get_work`, `_run_work`, `_deliver_callback`, `_inbound_authorized`). Reaproveita o sistema de goals/agent.

**Acesso via Kamui (padrão do ecossistema):** outros serviços alcançam o TARS por `/kamui/tars/api/tars/*` (proxy do Kamui → :62026; o Kamui enveloparia a resposta em `{ok, tether, endpoint, status, data}` — desembrulhe `data`). Testado ponta-a-ponta: `POST /kamui/tars/api/tars/work` → executa → `GET /kamui/tars/api/tars/work/{job}` done/ok.

**Documentação (descoberta):**
- No TARS: `GET /api/tars/manifest` — manifesto auto-descritivo (service, access direto+via_kamui, how_to_delegate_work com exemplo, tools, governança). Também `GET /api/tars/endpoints` (catálogo por módulo, inclui módulo `agent`).
- No Kamui: `backend/src/catalog/tars.ts` com a superfície real (16 outbound + 10 inbound, com examplePayloads); módulo 'tars' em `catalog/index.ts` `featured`; tether em `lib/tethers.ts` (baseUrl :62026). Aparece em `GET /kamui/endpoints`.

**Prova:** `backend/test_work_api.py` (sobe receptor de callback, delega, faz polling, confirma entrega): inbound OK, execução verificada OK, callback outbound OK.

> ⚠️ **Atenção:** ações cross-app via `kamui_call` NÃO passam pela governança de irreversibilidade do TARS (ela cobre só o shell/fs local). Foi assim que a publicação de vídeo via `sandbox2` do VideoGen ocorreu (o pipeline injeta `confirmPublicUpload` internamente). Avaliar gate por allowlist de bridges/endpoints sensíveis.
