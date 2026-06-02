# QA do catálogo do Kamui

> O catálogo do Kamui vive no repo **separado** `C:\projetos\kamui` (não no TARS). Documentado aqui porque o TARS é um tether e o índice é o ponto de descoberta do ecossistema.

O catálogo do Kamui (`GET /kamui/endpoints`, fonte: `backend/src/catalog/<tether>.ts` + `catalog/index.ts`, princípio §3.4 do `global_truth.md`) tende a ficar desatualizado — vários estavam factualmente errados (ex: TARS listava endpoints inexistentes; `simple` tinha 21 endpoints fantasma de uma versão antiga).

**Régua de qualidade (auditor):** `C:\projetos\kamui\backend\scripts\catalog-audit.mjs`. Roda com `node backend/scripts/catalog-audit.mjs [tether...]`. Valida cada tether **contra o serviço real**, read-only:
- sonda os GET concretos via Kamui (distingue TETHER proxiado em `/kamui/<id>/*` de módulo NATIVO do Kamui como `global`/`shikigami`, servido sob `/kamui` — usa `GET /kamui/tethers`);
- classifica ok / missing(404) / unreachable / error; 401/403/4xx = "existe";
- checa `examplePayload` é JSON válido, ids únicos, paths com `/`, métodos válidos, summary não-vazio;
- nota A(≥.95) B(≥.8) C(≥.6) D(≥.4) F. Templates `{id}` e SSE/WS não são sondados.

**Padrão de um bom catálogo de tether:** paths reais (derivados da fonte do serviço, ex: `api/server.py`), métodos corretos (GET=leitura→outbound, POST/PUT/DELETE=ação→inbound), summaries claros, `examplePayload` válido nos POST/PUT principais; nunca duplicar ids; documentar caminhos não-Kamui (ex: arquivo servido pelo dashboard) na summary, não como endpoint Kamui.

**Estado em 2026-06-02 após conserto:** **14/14 tethers grade A, 0 fantasmas, 0 erros TS**. Consertados nesta sessão: `simple` (reescrito contra `simple-ai/api/server.py`) e `shikigami` (dedup + entry corrigida); `tars` (reescrito antes). Único flag: `videogen` tem 2 endpoints reais que erram em runtime (`vid-dashboard-state` precisa `?key=`; `vid-el-voices` 502 ElevenLabs) — não é erro de catálogo.

**Próximo passo sugerido:** plugar o auditor no `kamui doctor` como gate de qualidade.
