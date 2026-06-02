import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic, MicOff, Volume2, VolumeX, Play, Trash2, Settings, AlertTriangle,
} from 'lucide-react';
import { useVoicePresence, type VoiceDecision } from '@/hooks/useVoicePresence';
import { useTheme } from '@/hooks/useTheme';

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] as const } },
};

export default function VoicePage() {
  const theme = useTheme();
  const voice = useVoicePresence({ aggressiveness: 0.62 });

  const [showSettings, setShowSettings] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0); // 0-1 para VAD visual

  // Carrega vozes ao montar
  useEffect(() => {
    // já é carregado no hook
  }, []);

  // Waveform visualizer profissional em tempo real (ativa só quando listening)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const draw = () => {
      if (!analyserRef.current) {
        // fallback visual quando não há analyser
        ctx.fillStyle = 'rgba(16, 185, 129, 0.08)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        animationRef.current = requestAnimationFrame(draw);
        return;
      }

      const bufferLength = analyserRef.current.frequencyBinCount;
      const freqData = new Uint8Array(bufferLength);
      analyserRef.current.getByteFrequencyData(freqData);

      // Melhor VAD profissional: RMS do domínio do tempo (melhor para fala real) + frequência
      const timeData = new Uint8Array(analyserRef.current.fftSize);
      analyserRef.current.getByteTimeDomainData(timeData);

      let sum = 0;
      for (let i = 0; i < timeData.length; i++) {
        const val = (timeData[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / timeData.length);

      const freqSum = freqData.reduce((a, b) => a + b, 0);
      const freqAvg = freqSum / bufferLength / 255;

      // Score de atividade de voz mais robusto e profissional
      const voiceActivity = Math.min(1, (rms * 1.8) + (freqAvg * 0.4));
      setAudioLevel(voiceActivity);

      // Feed live VAD into the hook (hook now owns the professional sustained-speech gate + triggering)
      if (voice.feedVadLevel) {
        voice.feedVadLevel(voiceActivity);
      } else if (voice.requestJudgeIfNeeded) {
        // Fallback for older hook versions
        voice.requestJudgeIfNeeded(voiceActivity);
      }

      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (freqData[i] / 255) * canvas.height * 0.9;
        const hue = 140 + (freqData[i] / 255) * 20;
        ctx.fillStyle = `hsla(${hue}, 85%, 65%, 0.85)`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    if (voice.isListening) {
      // Inicia áudio para visualização (separado do SpeechRecognition)
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          streamRef.current = stream;
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          audioContextRef.current = audioContext;

          const source = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 64;
          analyser.smoothingTimeConstant = 0.75;
          source.connect(analyser);
          analyserRef.current = analyser;

          draw();
        })
        .catch(() => {
          // Se falhar a permissão de visualização, ainda desenha algo estático
          draw();
        });
    } else {
      // Limpa tudo quando para de ouvir
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      analyserRef.current = null;

      // Limpa o canvas
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, [voice.isListening]);

  const lastDecision = voice.decisions[voice.decisions.length - 1]?.decision;
  const isCritical = lastDecision?.urgency === 'critical' || lastDecision?.urgency === 'high';

  return (
    <div className="space-y-8 pb-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Mic className="w-6 h-6" />
          <h1 className="text-2xl font-semibold tracking-[0.25em]">Voz &amp; Presença</h1>
        </div>
        <p className="text-sm text-white/60 max-w-2xl">
          Monitoramento contínuo de áudio humano. O TARS decide sozinho quando deve falar ou intervir — como um verdadeiro copiloto de missão.
        </p>
      </div>

      {/* Status + Controles principais */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Card de Monitoramento Principal */}
        <div className="lg:col-span-7 rounded-2xl border border-white/10 bg-white/[0.015] p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-white/40 mb-1">PRESENÇA DE VOZ</div>
              <div className="text-xl font-semibold">Detector de Necessidade de Fala</div>
            </div>

            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 rounded-lg border border-white/10 hover:bg-white/5"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>

          {/* Visualizador de Áudio em Tempo Real (profissional) + VAD */}
          <div className="mb-2">
            <div className="mb-4 h-16 rounded-xl border border-white/10 bg-black/40 overflow-hidden relative">
              <canvas 
                ref={canvasRef} 
                width={600} 
                height={64} 
                className="w-full h-full" 
              />
              {!voice.isListening && (
                <div className="absolute inset-0 flex items-center justify-center text-[10px] text-white/30 tracking-widest">
                  MICROFONE INATIVO — INICIE O MONITORAMENTO PARA VER O WAVEFORM
                </div>
              )}
            </div>

            {/* Indicador de Voice Activity (VAD) - tech ativa bem implementada */}
            {voice.isListening && (
              <div className="flex items-center gap-3 text-[10px]">
                <div className="text-white/40 w-20">Voice Activity</div>
                <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-emerald-400 transition-all duration-75"
                    style={{ width: `${Math.min(100, audioLevel * 140)}%` }}
                  />
                </div>
                <div className="font-mono text-emerald-400 w-8 text-right">{(audioLevel * 100).toFixed(0)}%</div>
              </div>
            )}
          </div>

          {/* Botão gigante de escuta */}
          <button
            onClick={voice.toggleListening}
            className={`group w-full h-28 rounded-2xl flex items-center justify-center gap-4 text-lg font-medium tracking-wider transition-all border
              ${voice.isListening
                ? 'bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/15'
                : 'bg-white/5 border-white/15 hover:border-white/30 text-white'
              }`}
          >
            {voice.isListening ? (
              <>
                <MicOff className="w-8 h-8 group-active:scale-95 transition" />
                PARAR MONITORAMENTO CONTÍNUO
              </>
            ) : (
              <>
                <Mic className="w-8 h-8 group-active:scale-95 transition" />
                INICIAR MONITORAMENTO CONTÍNUO
              </>
            )}
          </button>

          {/* Botões de Teste para provar funcionalidade */}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                const sample = "TARS, qual é a janela de transferência para Marte?";
                // Usa o método dedicado do hook (atualiza UI + força juiz + TTS)
                if (voice.simulateHumanSpeech) {
                  voice.simulateHumanSpeech(sample);
                } else {
                  // Fallback
                  fetch('/api/tars/voice/judge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ transcript: sample, aggressiveness: voice.aggressiveness })
                  })
                  .then(r => r.json())
                  .then(data => {
                    if (data.decision?.should_speak && data.decision.text) {
                      voice.speak(data.decision.text);
                    }
                  });
                }
              }}
              className="flex-1 text-xs px-3 py-2 rounded-lg border border-white/15 hover:bg-white/5"
              disabled={voice.isListening}
            >
              Testar Fluxo Completo (frase de exemplo)
            </button>

            <button
              onClick={() => voice.testSpeak()}
              className="flex-1 text-xs px-3 py-2 rounded-lg border border-white/15 hover:bg-white/5"
            >
              Testar TTS com parâmetros atuais
            </button>
          </div>

          {/* Botão poderoso de prova manual - permite ao usuário forçar o juiz a qualquer momento */}
          <div className="mt-2">
            <button
              onClick={() => {
                if (voice.forceJudgeCall) {
                  voice.forceJudgeCall();
                } else if (voice.callJudge) {
                  voice.callJudge(audioLevel);
                }
              }}
              className="w-full text-xs px-3 py-2 rounded-lg border border-sky-400/50 text-sky-400 hover:bg-sky-500/10"
              disabled={!voice.isListening}
            >
              CHAMAR JUIZ AGORA (com VAD atual) — Prova manual do fluxo completo
            </button>
            <div className="text-[9px] text-white/40 mt-0.5 text-center">
              Ignora gate de silêncio e força análise imediata do buffer + decisão do GLM
            </div>
          </div>

          {/* Automated Self-Test Suite (para provar funcionalidade) */}
          <div className="mt-3">
            <button
              onClick={async () => {
                if (voice.runVoiceSelfTestSuite) {
                  const results = await voice.runVoiceSelfTestSuite();
                  console.log("Voice Self-Test Suite Results:", results);
                  const passed = results.filter(r => r.passed).length;
                  const total = results.length;
                  alert(`Voice Self-Test Suite: ${passed}/${total} passed\n\n` + 
                        results.map(r => `${r.passed ? '✅' : '❌'} ${r.name}: ${r.details}`).join('\n'));
                }
              }}
              className="w-full text-xs px-3 py-2 rounded-lg border border-emerald-400/50 text-emerald-400 hover:bg-emerald-500/10"
              disabled={!voice.isListening}
            >
              Run Automated Voice Self-Test Suite (3 scenarios)
            </button>
            <div className="text-[9px] text-white/40 mt-1 text-center">
              Runs TTS + Simulate + VAD checks. Results in console + alert.
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-[11px] text-white/50">
            <div>
              {voice.isListening ? 'O TARS está ouvindo o ambiente...' : 'Clique para ativar o microfone'}
            </div>
            <div className="font-mono">
              Agressividade: {voice.aggressiveness.toFixed(2)}
            </div>
          </div>

          {/* Listening Health / Diagnostics (profissional) */}
          {voice.isListening && (
            <div className="mt-2 text-[10px] text-white/60 flex gap-4 font-mono items-center flex-wrap">
              <div>Uptime: {Math.floor(voice.listeningUptimeSeconds / 60)}m {voice.listeningUptimeSeconds % 60}s</div>
              <div>Restarts: {voice.restartCount}</div>
              <div>VAD: {(audioLevel * 100).toFixed(0)}%</div>
              <div>Health: {voice.healthScore}%</div>
              <div>Stability: {voice.stabilityScore}%</div>
              {voice.recentJudgeSuccessRate !== null && (
                <div>Judge Success: {voice.recentJudgeSuccessRate}% (last 10)</div>
              )}
              {voice.lastJudgeSuccessTs && (
                <div>Judge OK: {Math.floor((Date.now() - voice.lastJudgeSuccessTs) / 1000)}s ago</div>
              )}
              {(voice.restartCount > 3 || voice.error || voice.healthScore < 50 || voice.stabilityScore < 60) && (
                <button
                  onClick={() => voice.forceFullRestart?.()}
                  className="text-[9px] px-2 py-0.5 border border-orange-400/50 text-orange-400 rounded hover:bg-orange-500/10"
                >
                  FORÇAR RESET COMPLETO
                </button>
              )}
            </div>
          )}

          {/* Agressividade slider */}
          <div className="mt-4">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={voice.aggressiveness}
              onChange={(e) => voice.setAggressiveness(parseFloat(e.target.value))}
              className="w-full accent-emerald-500"
              disabled={voice.isListening}
            />
            <div className="flex justify-between text-[10px] text-white/40 mt-1">
              <div>Muito calado</div>
              <div>Proativo</div>
            </div>
          </div>

          {/* Controles de Voz TARS (TTS) - agora expostos e configuráveis */}
          <div className="mt-5 pt-4 border-t border-white/10">
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/40 mb-2">Voz do TARS (TTS)</div>
            
            <div className="space-y-3 text-xs">
              <div>
                <div className="flex justify-between text-white/60 mb-1">
                  <span>Velocidade</span>
                  <span>{voice.ttsRate.toFixed(2)}</span>
                </div>
                <input
                  type="range" min={0.7} max={1.1} step={0.01}
                  value={voice.ttsRate}
                  onChange={(e) => voice.setTtsRate(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>
              <div>
                <div className="flex justify-between text-white/60 mb-1">
                  <span>Tom (Pitch)</span>
                  <span>{voice.ttsPitch.toFixed(2)}</span>
                </div>
                <input
                  type="range" min={0.7} max={1.2} step={0.01}
                  value={voice.ttsPitch}
                  onChange={(e) => voice.setTtsPitch(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>
              <div>
                <div className="flex justify-between text-white/60 mb-1">
                  <span>Volume</span>
                  <span>{voice.ttsVolume.toFixed(2)}</span>
                </div>
                <input
                  type="range" min={0.5} max={1} step={0.01}
                  value={voice.ttsVolume}
                  onChange={(e) => voice.setTtsVolume(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>
            </div>
          </div>

          {voice.error && (
            <div className="mt-3 text-xs text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5" /> {voice.error}
            </div>
          )}
        </div>

        {/* Painel de Status Rápido */}
        <div className="lg:col-span-5 rounded-2xl border border-white/10 bg-white/[0.015] p-6 flex flex-col">
          <div className="text-xs uppercase tracking-[0.3em] text-white/40 mb-3">ESTADO ATUAL</div>

          <div className="space-y-4 flex-1">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${voice.isListening ? 'bg-emerald-400 animate-pulse' : 'bg-white/30'}`} />
              <span className="text-sm">{voice.isListening ? 'Ouvindo ativamente' : 'Em standby'}</span>
            </div>

            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${voice.isSpeaking ? 'bg-amber-400' : 'bg-white/30'}`} />
              <span className="text-sm">{voice.isSpeaking ? 'TARS está falando...' : 'TARS silencioso'}</span>
            </div>

            {lastDecision && (
              <div className={`rounded-xl p-3 text-xs border ${isCritical ? 'border-red-500/40 bg-red-500/5' : 'border-white/10 bg-white/5'}`}>
                <div className="uppercase tracking-widest text-white/40 mb-1">Última decisão</div>
                <div className="text-white/80">{lastDecision.reason}</div>
                {lastDecision.should_speak && (
                  <div className="mt-1.5 text-emerald-400">→ Falou: “{lastDecision.text}”</div>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => voice.testSpeak()}
              disabled={voice.isSpeaking}
              className="btn-rift flex-1 flex items-center justify-center gap-2 text-xs disabled:opacity-40"
            >
              <Play className="w-3.5 h-3.5" /> Testar voz do TARS
            </button>
            <button onClick={voice.clearTranscript} className="btn-rift flex items-center gap-2 text-xs px-3">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Transcrição ao vivo + Decisões */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Transcrição */}
        <div className="rounded-2xl border border-white/10 bg-black/30 p-5 min-h-[340px] flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-[0.3em] text-white/40">TRANSCRIÇÃO AO VIVO</div>
            <div className="text-[10px] text-white/40">{voice.transcript.length} turnos</div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 text-sm font-light pr-1 custom-scroll">
            {voice.transcript.length === 0 && (
              <div className="text-white/40 text-sm pt-8 text-center">Nenhuma fala transcrita ainda.<br />Ative o monitoramento e comece a falar.</div>
            )}

            {voice.transcript.map((entry) => (
              <div key={entry.id} className={`flex gap-3 ${entry.speaker === 'tars' ? 'justify-end' : ''}`}>
                <div className={`max-w-[82%] rounded-2xl px-4 py-2 ${entry.speaker === 'tars'
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-200'
                  : 'bg-white/5 border border-white/10'}`}>
                  <div className="text-[10px] tracking-widest text-white/40 mb-0.5">
                    {entry.speaker === 'tars' ? 'TARS' : 'HUMANO'}
                  </div>
                  {entry.text}
                </div>
              </div>
            ))}

            {voice.currentInterim && (
              <div className="opacity-60 text-white/70 pl-1 text-sm italic">
                {voice.currentInterim} <span className="animate-pulse">…</span>
              </div>
            )}
          </div>
        </div>

        {/* Log de Decisões do Detector */}
        <div className="rounded-2xl border border-white/10 bg-black/30 p-5 min-h-[340px] flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-[0.3em] text-white/40">DECISÕES DO DETECTOR</div>
            <div className="text-[10px] text-white/40">o que o TARS pensou</div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scroll text-xs">
            {voice.decisions.length === 0 && (
              <div className="text-white/40 pt-8 text-center text-sm">O detector ainda não emitiu julgamentos.</div>
            )}

            <AnimatePresence>
              {voice.decisions.slice().reverse().map((d, idx) => (
                <motion.div
                  key={d.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`rounded-xl border p-3 ${d.decision.should_speak ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/10 bg-white/5'}`}
                >
                  <div className="flex items-center gap-2 text-[10px] text-white/50 mb-1">
                    <span>{new Date(d.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <span className="uppercase tracking-widest">{d.decision.urgency}</span>
                  </div>
                  <div className="text-white/80">{d.decision.reason}</div>
                  {d.decision.should_speak && d.decision.text && (
                    <div className="mt-1.5 text-emerald-400 text-[12px]">“{d.decision.text}”</div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Seletor de Voz + Controles */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.015] p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-[0.3em] text-white/40">VOZ DO TARS</div>
          {voice.ttsEngine && (
            <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${
              voice.ttsEngine === 'omnivoice'
                ? 'border-emerald-500/40 text-emerald-300/80 bg-emerald-500/10'
                : 'border-white/20 text-white/50 bg-white/5'
            }`}>
              {voice.ttsEngine === 'omnivoice' ? 'OmniVoice (clonada)' : 'Navegador (fallback)'}
            </span>
          )}
        </div>

        {/* Voz clonada do OmniVoice (via ponte Kamui) — engine principal */}
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <select
            value={voice.selectedOmniVoice || ''}
            onChange={(e) => voice.setOmniVoice(e.target.value)}
            className="bg-black/40 border border-emerald-500/20 rounded-xl px-4 py-2 text-sm min-w-[280px]"
          >
            {voice.omniVoices.length === 0 && <option value="">OmniVoice offline — usando navegador</option>}
            {voice.omniVoices.map((v) => (
              <option key={v.slug} value={v.slug}>
                {v.name}{v.language ? ` (${v.language})` : ''}
              </option>
            ))}
          </select>

          <button
            onClick={() => voice.testSpeak()}
            disabled={voice.isSpeaking}
            className="btn-rift flex items-center gap-2 text-sm px-5 disabled:opacity-40"
          >
            <Volume2 className="w-4 h-4" /> Testar voz
          </button>

          <div className="text-[11px] text-white/50 ml-2">
            Voz clonada via OmniVoice (Kamui). Cai pro TTS do navegador se o serviço estiver fora.
          </div>
        </div>

        {/* Engine de reconhecimento de fala (STT) */}
        <div className="flex flex-wrap items-center gap-3 mb-3 pt-3 border-t border-white/5">
          <span className="text-[11px] uppercase tracking-wider text-white/40">Reconhecimento (STT)</span>
          <div className="flex rounded-xl border border-white/15 overflow-hidden text-xs">
            <button
              onClick={() => voice.setSttEngine('whisper')}
              disabled={voice.isListening}
              className={`px-3 py-1.5 disabled:opacity-50 ${voice.sttEngine === 'whisper' ? 'bg-emerald-500/20 text-emerald-200' : 'text-white/50 hover:text-white/80'}`}
            >
              Whisper (local)
            </button>
            <button
              onClick={() => voice.setSttEngine('webspeech')}
              disabled={voice.isListening}
              className={`px-3 py-1.5 disabled:opacity-50 ${voice.sttEngine === 'webspeech' ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80'}`}
            >
              Navegador
            </button>
          </div>
          <div className="text-[11px] text-white/40">
            {voice.isListening
              ? 'Pare o monitoramento para trocar a engine.'
              : 'Whisper transcreve no servidor (offline, sem Google). Navegador é o fallback.'}
          </div>
        </div>

        {/* Fallback do navegador — usado só quando o OmniVoice não responde */}
        <details className="text-xs">
          <summary className="cursor-pointer text-white/40 hover:text-white/60">Voz de fallback (navegador)</summary>
          <select
            value={voice.selectedVoiceURI || ''}
            onChange={(e) => voice.setVoice(e.target.value)}
            className="mt-2 bg-black/40 border border-white/15 rounded-xl px-4 py-2 text-sm min-w-[280px]"
          >
            {voice.availableVoices.length === 0 && <option>Carregando vozes...</option>}
            {voice.availableVoices.map((v, i) => (
              <option key={i} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </details>
      </div>

      <div className="text-[10px] text-white/40 text-center">
        O TARS usa o modelo <span className="font-mono text-white/60">glm-5.1 (z.ai)</span> ou OpenRouter como juiz da necessidade de fala.
      </div>
    </div>
  );
}
