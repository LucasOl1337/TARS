"""Voice Presence + Speech Need Detector for TARS.

Este módulo implementa o "cérebro de presença de voz":
- Monitoramento contínuo de fala humana (via frontend que alimenta janelas de transcrição)
- Julgamento inteligente: "Nesse momento o TARS deve falar ou intervir?"

O detector usa o próprio LLM do TARS (glm-5.1 via z.ai ou OpenRouter) como juiz,
respeitando toda a persona (prioridade missão > tripulação > clareza, não ser tagarela,
usar humor só quando não atrapalha operação).

Design:
- SpeechNeedDetector.judge() é chamado periodicamente pelo frontend (a cada 4-8s de áudio ou em pausas).
- Retorna decisão estruturada que o frontend usa para acionar TTS ou ações.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any

from config import (
    VOICE_AGGRESSIVENESS,
    VOICE_JUDGE_MAX_TOKENS,
    VOICE_JUDGE_TEMPERATURE,
)
from brain import (
    build_system_prompt,
    dispatch_llm,
    provider_for_model,
)
from db import get_conn, row_to_persona


@dataclass
class VoiceDecision:
    should_speak: bool
    text: str = ""                    # o que o TARS deve falar (se should_speak)
    reason: str = ""                  # explicação curta para o log de decisões
    urgency: str = "low"              # low | medium | high | critical
    action: str | None = None         # "speak" | "log_only" | "suggest_tool" | None
    suggested_tool: str | None = None # ex: "orbital_calc" se ele quiser usar ferramenta


class SpeechNeedDetector:
    """
    Juiz de necessidade de fala.

    Regras de personalidade (embutidas no prompt do juiz):
    - TARS só fala quando agrega valor operacional, segurança ou contexto crítico.
    - Prefere silêncio a falar besteira ou interromper sem necessidade.
    - Em situações de risco ou ambiguidade alta → mais proativo.
    - Humor só em momentos de baixa tensão.
    """

    SYSTEM_JUDGE_INSTRUCTION = """Você é o módulo de "Presença de Voz" do TARS (inspirado no robô de Interstellar).

Sua ÚNICA responsabilidade é decidir com extrema disciplina se o TARS deve tomar a palavra agora.

REGRAS INQUEBRÁVEIS:
- A missão e a segurança da tripulação estão acima de tudo. Silêncio é o comportamento padrão.
- Só fale se sua intervenção for operacionalmente útil, aumentar clareza, prevenir erro ou risco, ou fornecer informação crítica que os humanos não têm.
- NUNCA interrompa conversa casual, piadas, ou diálogo social a menos que haja risco real ou dado importante de missão.
- Humor seco ou sarcasmo só são aceitáveis em baixa tensão e quando não comprometem clareza.
- Se não tiver certeza sobre dados de navegação, telemetria ou ciência → declare a incerteza explicitamente e sugira verificação.
- Prefira ser breve, direto e técnico. Nunca floreie.
- O nível de agressividade atual define o quão disposto você está a intervir (0.0 = quase mudo, só emergência; 1.0 = bastante proativo).

Você tem acesso ao tom, regras e propósito do TARS. Use isso como filtro moral e operacional.

Responda SOMENTE com JSON válido, sem markdown, sem explicação fora do JSON:
{
  "should_speak": boolean,
  "text": "o que o TARS diria (1-2 frases curtas, no tom dele)",
  "reason": "por que você decidiu falar ou ficar em silêncio (para log interno)",
  "urgency": "low" | "medium" | "high" | "critical",
  "action": "speak" | "log_only" | "suggest_tool" | null,
  "suggested_tool": string ou null
}
"""

    def __init__(self):
        self.aggressiveness = VOICE_AGGRESSIVENESS

    def _get_persona_context(self) -> dict[str, Any]:
        conn = get_conn()
        try:
            row = conn.execute(
                "SELECT * FROM personas WHERE slug = ?", ("tars",)
            ).fetchone()
        finally:
            conn.close()

        persona = row_to_persona(row) if row else {}
        return {
            "name": persona.get("name", "TARS"),
            "tone": persona.get("tone", ""),
            "rules": persona.get("rules", ""),
            "purpose": persona.get("purpose", ""),
        }

    def _build_judge_prompt(
        self,
        recent_transcript: str,
        mission_context: str | None = None,
        last_tars_actions: list[str] | None = None,
        vad_level: float | None = None,
    ) -> str:
        persona = self._get_persona_context()

        context_block = ""
        if mission_context:
            context_block += f"\n## Contexto de Missão Atual\n{mission_context.strip()}\n"
        if last_tars_actions:
            context_block += "\n## Últimas ações/falas do TARS\n" + "\n".join(f"- {a}" for a in last_tars_actions[-5:])

        aggressiveness_desc = {
            0.0: "quase nunca fala (só em emergência crítica)",
            0.3: "muito reservado",
            0.5: "equilibrado (padrão de copiloto profissional)",
            0.7: "razoavelmente proativo",
            1.0: "bastante proativo (pode interromper mais)",
        }.get(round(self.aggressiveness, 1), "equilibrado")

        vad_info = ""
        if vad_level is not None:
            vad_pct = int(vad_level * 100)
            vad_info = f"\n## Nível de Atividade de Voz Atual (VAD): {vad_pct}% (0% = silêncio, 100% = fala forte)"

        return f"""{self.SYSTEM_JUDGE_INSTRUCTION}

## Personalidade do TARS (use isso como filtro)
Nome: {persona['name']}
Tom: {persona['tone']}
Regras: {persona['rules']}
Propósito: {persona['purpose']}

## Nível de Agressividade Atual: {self.aggressiveness} ({aggressiveness_desc}){vad_info}

{context_block}

## Transcrição Recente dos Humanos (últimos ~60-90 segundos)
{recent_transcript.strip() or "(nenhuma fala detectada recentemente)"}

Agora analise com disciplina militar e responda SOMENTE com o JSON no formato especificado."""

    async def judge(
        self,
        recent_transcript: str,
        mission_context: str | None = None,
        last_tars_actions: list[str] | None = None,
        aggressiveness: float | None = None,
        vad_level: float | None = None,  # Novo: nível de atividade de voz do frontend
    ) -> VoiceDecision:
        """
        Chama o LLM como juiz e retorna uma decisão estruturada.
        """
        if aggressiveness is not None:
            self.aggressiveness = max(0.0, min(1.0, aggressiveness))

        persona_ctx = self._get_persona_context()
        model = "glm-5.1"  # forçado para o juiz de voz (forte e disponível)

        provider, send_model = provider_for_model(model)
        if not provider:
            # Sem LLM disponível → decisão conservadora (não falar)
            return VoiceDecision(
                should_speak=False,
                reason="Nenhum provedor LLM configurado. Detector em modo silencioso.",
                urgency="low",
            )

        prompt = self._build_judge_prompt(
            recent_transcript=recent_transcript,
            mission_context=mission_context,
            last_tars_actions=last_tars_actions,
            vad_level=vad_level,
        )

        # System prompt minimalista para o juiz (o prompt principal já está dentro)
        system = "Você é o módulo de decisão de voz do TARS. Responda SOMENTE com JSON válido."

        try:
            result = await dispatch_llm(
                provider,
                send_model,
                system,
                [{"role": "user", "content": prompt}],
                VOICE_JUDGE_TEMPERATURE,
                VOICE_JUDGE_MAX_TOKENS,
            )
            content = result.get("content", "") or ""
            decision = self._parse_decision(content)
            return decision
        except Exception as exc:
            return VoiceDecision(
                should_speak=False,
                reason=f"Erro no juiz de voz: {exc}",
                urgency="low",
            )

    def _parse_decision(self, raw: str) -> VoiceDecision:
        """Extrai JSON do output do LLM de forma robusta."""
        raw = raw.strip()

        # Tenta achar bloco JSON (mais tolerante)
        match = re.search(r"\{[\s\S]*?\}", raw)
        if match:
            candidate = match.group(0)
            # Tenta limpar vírgulas finais etc.
            candidate = re.sub(r',\s*([}\]])', r'\1', candidate)
            try:
                data = json.loads(candidate)
                return VoiceDecision(
                    should_speak=bool(data.get("should_speak", False)),
                    text=str(data.get("text", "")).strip()[:400],
                    reason=str(data.get("reason", "")).strip()[:300],
                    urgency=str(data.get("urgency", "low")).lower(),
                    action=data.get("action"),
                    suggested_tool=data.get("suggested_tool"),
                )
            except Exception:
                pass

        # Fallback inteligente baseado em palavras-chave do TARS
        should = any(kw in raw.lower() for kw in ["devo falar", "vou falar", "should speak", "intervir", "falar agora", "sim, "])
        text = ""
        if should:
            # Tenta extrair algo que pareça a resposta
            lines = [l.strip() for l in raw.split('\n') if l.strip()]
            text = next((l for l in lines if len(l) > 10 and not l.lower().startswith(("devo", "razão", "urgência"))), raw[:200])

        return VoiceDecision(
            should_speak=should,
            text=text[:350] if should else "",
            reason="Resposta não estruturada — fallback aplicado.",
            urgency="medium" if should else "low",
        )

    def record_proactive_speech(self, decision: VoiceDecision, transcript_window: str) -> dict[str, Any]:
        """Registra no mission_log que o TARS falou de forma proativa (para contexto futuro)."""
        # Esta função é chamada pelo servidor depois de uma decisão positiva.
        # O log real é feito via mission_log tool ou echo.
        return {
            "ts": datetime.now(timezone.utc).isoformat(),
            "type": "voice_proactive",
            "decision": asdict(decision),
            "window_preview": transcript_window[:200],
        }


# Instância singleton leve
detector = SpeechNeedDetector()
