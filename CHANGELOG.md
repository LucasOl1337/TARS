# Changelog

Todas as notas relevantes da versão atual do TARS ficam aqui.

## 2026-06-06 - Snapshot atual

Commit de referência: `3058d57 chore: snapshot current TARS version`.

### Adicionado

- Runtime agêntico com goals, steps, heartbeat, kill-switch e API de trabalho inbound.
- Event store para registrar eventos operacionais.
- Harness de validação com fluxos persistidos, componentes executáveis e endpoints dedicados.
- Páginas novas no dashboard para Engines e Harness.
- Componente 3D do TARS no dashboard usando Three.js.
- Voz com decisor de presença, STT via faster-whisper e TTS via OmniVoice por ponte Kamui.
- Landing page separada em `site/` com assets públicos, build Vite e preview próprio.
- Ferramentas novas: `assert_check`, `desktop_write` e `project_scan`.
- Evidências de teste em `output/`, incluindo screenshots desktop/mobile e status de soak.

### Alterado

- Backend expandido com novas rotas para chat, modelos, goals, work API, memória, voz, testes, harness, bridges, eventos, portas e serviços.
- Dashboard atualizado com navegação, páginas operacionais, tema visual e integração ampliada com a API.
- Configuração de ambiente documentada em `backend/.env.example`, incluindo GLM, 9Router, bridges, portas e TTS.
- Scripts `start-tars.ps1` e `stop-tars.ps1` atualizados para operar backend e dashboard nas portas canônicas.
- Ferramenta `grok_imagine` ajustada para integração com VideoGen/Grok Imagine.

### Removido

- Grande parte dos assets antigos em `grokassets/`.
- Assets principais remanejados para `site/public/assets/` quando ainda usados pela landing.

### Dependências

- Backend: FastAPI, Uvicorn, HTTPX, python-dotenv, python-multipart, faster-whisper e runtime CUDA opcional para STT.
- Dashboard: React 19, Vite 6, TypeScript, Three.js, lucide-react, framer-motion e Tailwind.
- Landing: React 19, Vite 6, TypeScript, Three.js e lucide-react.

### Observações

- O TARS roda sem chave de LLM para operações locais, mas chat real e alguns testes de decisão dependem de provider configurado.
- Bridges para Yume, Kamui, VideoGen, 9Router e OmniVoice são opcionais e dependem dos respectivos serviços locais.
- O banco runtime `data/tars.db` continua ignorado pelo Git.
