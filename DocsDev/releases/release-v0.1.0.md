![v0.1.0](https://github.com/LucasOl1337/TARS/releases/download/v0.1.0/v0.1.0-card.png)

# v0.1.0 — Baseline oficial (22/06/2026)

Primeira release oficial do TARS, registrando o baseline publicado do runtime local de agente autônomo com backend FastAPI, dashboard operacional e landing page.

## Novidades

- **Runtime agêntico local:** o backend em `backend/` expõe goals, steps, heartbeat, kill-switch, memória persistente, mission log e execução de ferramentas pela API local.
- **Dashboard operacional:** o app React/Vite em `dashboard/` permite operar runtime, engines, tools, missions, voice, persona, endpoints e harness.
- **Landing pública:** o app React/Vite em `site/` mantém a apresentação pública do projeto separada do dashboard operacional.
- **Voz e bridges:** o backend inclui decisor de presença de voz, STT via faster-whisper, TTS via OmniVoice/Kamui e pontes opcionais para Yume, Kamui e VideoGen.

## Melhorias

- **Prompt e persona compostos:** `backend/brain.py` monta o system prompt a partir de identidade, função, tom, regras, capacidades, ferramentas, exemplos e modelo conforme `prompt_flow`.
- **Tools declarativas:** os manifestos em `ferramentas/*.json` formam o catálogo carregado pelo backend, separando capacidade operacional do código principal.
- **Dispatch multi-provider:** o chat resolve provedores GLM, Kimi, Anthropic, OpenRouter e 9Router a partir do modelo e das chaves configuradas.

## Correções

- **Baseline sem correções destacadas:** esta publicação consolidou o estado inicial do repositório; não há correção isolada documentada para o ciclo.

## Sistemas

- **API canônica:** as rotas principais ficam em `/api/tars/*`, com aliases `/api/kamui/*` mantidos para compatibilidade com telas herdadas.
- **Governança local:** `backend/governance.py` concentra sandbox de caminhos, allowlist de executáveis, denylist destrutiva, bloqueio de ações irreversíveis e kill-switch persistido.
- **Portas documentadas:** backend, dashboard e landing usam portas fixas documentadas no README, com scripts `start-tars.ps1` e `stop-tars.ps1` para operação local.

---

## Notas técnicas

Base inicial do repositório até `9c5e7e1946d268a18996c77ae885ea357ced5874`. Release publicado como `v0.1.0`; não houve bump, retag ou alteração de código neste reparo. O gate de release exigiu completar o GitHub Release com card PNG anexado e imagem embutida no topo.
