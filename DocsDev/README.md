# DocsDev — Documentação de desenvolvimento do TARS

Pasta de documentação forte do projeto. Começou em **2026-06-02**.

## Como navegar

- **Comece pelo handoff** (visão geral + estado atual + pendências + riscos):
  [`2026-06-02_handoff_tars-agente-autonomo.md`](./2026-06-02_handoff_tars-agente-autonomo.md)
- **Referência por subsistema** em [`reference/`](./reference/):
  - [`agentic-runtime.md`](./reference/agentic-runtime.md) — loop ReAct, goals, verificação, governança, memória, heartbeat, sub-agentes.
  - [`grok-imagine.md`](./reference/grok-imagine.md) — geração de imagem dirigindo o grok CLI (`/imagine`).
  - [`dashboard-missions.md`](./reference/dashboard-missions.md) — página Missões (interação direta com o agente).
  - [`service-api.md`](./reference/service-api.md) — API inbound/outbound (`/work` + callback) e acesso via Kamui.
  - [`kamui-catalog-qa.md`](./reference/kamui-catalog-qa.md) — auditor de qualidade do catálogo do Kamui e padrão de qualidade.

## Convenção

- Docs novas e fortes do projeto vivem **aqui** (não espalhar).
- O `README.md` da raiz do repo continua sendo o overview-raiz.
- Estas referências foram consolidadas a partir da memória persistente do agente
  (`~/.claude/projects/C--Projetos-TARS/memory/`), que está **fora do repo** — aqui
  ficam dentro dele, para qualquer agente futuro ter o contexto sem depender daquela memória.
