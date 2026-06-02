# Grok Imagine — geração de imagem do TARS

O TARS gera imagens dirigindo o **grok** (TUI agêntica da xAI, "Grok Terminal", em `~/.grok/bin/grok.exe`, autenticado). O slash-command nativo `/imagine` usa o **Grok Imagine**. Não há MCP envolvido (o `codex-image-generator` MCP está quebrado e é irrelevante).

- **Módulo:** `backend/grok_imagine.py` — porta o padrão comprovado do usuário (`VideoGen/FLUXO/gerar-imagens/grok-terminal-image-runner.mjs`).
- **Invocação headless:** `grok --cwd <dir> -p "/imagine <prompt>\nDo not add text or watermark.\n..." --no-subagents --output-format plain`. O grok salva a imagem (JPEG) na pasta de sessão `~/.grok/sessions/<cwd-encoded>/.../images/N.jpg`.
- **Mecânica:** snapshot das imagens da sessão antes → roda grok → varre a árvore de sessões por imagem nova/utilizável (>15KB) após o start → copia para o destino.
- **Tool:** `grok_imagine` (builtin, `ferramentas/grok_imagine.json`). Params: `prompt`, `filename`, `dest`, `output_path`. Default de destino = **Desktop** (`%USERPROFILE%\Desktop`). ~30-90s por imagem. 1 chamada = 1 imagem.
- **Governança:** destino restrito ao perfil do usuário ou ao workspace; respeita kill-switch.

**Validado (2026-06-02):** missão "1 cavalo + 2 leões no Desktop" cumprida autônoma; verificador aprovou; 3 JPEGs reais no Desktop. Runner: `backend/mission_grok.py`.

> ⚠️ **Nota:** o grok produz **JPEG** mesmo quando o `filename` é `.png` (mismatch cosmético; abre normal). Corrigir = honrar a extensão de origem ou reencodar.
