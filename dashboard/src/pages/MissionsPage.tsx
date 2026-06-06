import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Flag,
  Hash,
  Heart,
  Loader2,
  Octagon,
  Rocket,
  ShieldCheck,
  Sparkles,
  Square,
  Target,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

// ─── tipos ──────────────────────────────────────────────────────────────────

interface Goal {
  id: string;
  title: string;
  description?: string;
  definition_of_done?: string;
  status: string;
  origin?: string;
  iterations?: number;
  tool_calls?: number;
  tokens_used?: number;
  max_iterations?: number;
  result?: string | null;
  verifier?: { passed?: boolean; reason?: string; missing?: string[] } | null;
  created_at?: string;
  finished_at?: string | null;
}

interface Step {
  idx: number;
  phase: string;
  thought?: string;
  action?: string;
  tool_input?: unknown;
  observation?: unknown;
  ok: number;
  elapsed_ms?: number;
}

interface Heartbeat {
  enabled?: boolean;
  auto_run?: boolean;
  allow_proposals?: boolean;
  beats?: number;
  last_action?: string;
  kill_switch?: boolean;
}

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.4, 0, 0.2, 1] as const } },
};

const PRESETS: Array<{ label: string; title: string; description: string; dod: string }> = [
  {
    label: 'Imagem no Desktop',
    title: 'Gerar uma imagem e salvar no Desktop',
    description: 'Use o Grok Imagine (ferramenta grok_imagine) para gerar uma imagem de um astronauta surfando em um anel de Saturno e salve no Desktop como astronauta.png.',
    dod: 'Existe no Desktop um arquivo astronauta.png (>0 bytes) gerado via Grok Imagine.',
  },
  {
    label: 'Código + rodar',
    title: 'Escrever e executar um script Python',
    description: 'Escreva um script Python que liste os 20 primeiros números primos, execute-o via shell e salve a saída no Desktop em primos.txt.',
    dod: 'O script rodou com sucesso e primos.txt no Desktop contém os 20 primeiros primos.',
  },
  {
    label: 'VideoGen via Kamui',
    title: 'Disparar pipeline sandbox2 do VideoGen via Kamui',
    description: 'Através do Kamui (kamui_call), dispare POST /kamui/videogen/api/sandbox2/run com format=shorts e o targetChannelId do canal, capture o operationId e confirme o progresso via GET /kamui/videogen/api/operations/{id}.',
    dod: 'Pipeline sandbox2 disparado via Kamui com operationId capturado e operação confirmada em execução.',
  },
];

// ─── helpers ──────────────────────────────────────────────────────────────────

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok && !data?.ok && data?.error) throw new Error(data.error);
  return data as T;
}

function statusStyle(status: string): { color: string; bg: string; label: string; pulse?: boolean } {
  switch (status) {
    case 'done': return { color: '#54d6a4', bg: 'rgba(84,214,164,0.12)', label: 'concluída' };
    case 'failed': return { color: '#e8746b', bg: 'rgba(232,116,107,0.12)', label: 'falhou' };
    case 'running': return { color: '#7fb4ff', bg: 'rgba(127,180,255,0.12)', label: 'executando', pulse: true };
    case 'verifying': return { color: '#e0a846', bg: 'rgba(224,168,70,0.12)', label: 'verificando', pulse: true };
    case 'cancelled': return { color: '#9aa6b4', bg: 'rgba(154,166,180,0.10)', label: 'cancelada' };
    default: return { color: '#9aa6b4', bg: 'rgba(154,166,180,0.10)', label: 'na fila' };
  }
}

function phaseMeta(phase: string): { icon: React.ElementType; color: string } {
  switch (phase) {
    case 'act': return { icon: Wrench, color: '#7fb4ff' };
    case 'verify': return { icon: ShieldCheck, color: '#e0a846' };
    case 'finish': return { icon: Flag, color: '#54d6a4' };
    case 'error': return { icon: XCircle, color: '#e8746b' };
    default: return { icon: Brain, color: '#9aa6b4' };
  }
}

function pretty(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

const ACTIVE = new Set(['running', 'verifying', 'pending']);

// ─── componente ──────────────────────────────────────────────────────────────

export default function MissionsPage() {
  const theme = useTheme();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [heartbeat, setHeartbeat] = useState<Heartbeat | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dod, setDod] = useState('');
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trailRef = useRef<HTMLDivElement>(null);

  const loadGoals = useCallback(async () => {
    try {
      const data = await api<{ goals: Goal[] }>('/api/tars/goals?limit=50');
      setGoals(data.goals || []);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  const loadHeartbeat = useCallback(async () => {
    try {
      const data = await api<{ heartbeat: Heartbeat }>('/api/tars/heartbeat');
      setHeartbeat(data.heartbeat);
    } catch { /* backend pode estar reiniciando */ }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const [g, s] = await Promise.all([
        api<{ goal: Goal }>(`/api/tars/goals/${id}`),
        api<{ steps: Step[] }>(`/api/tars/goals/${id}/steps`),
      ]);
      setGoal(g.goal);
      setSteps(s.steps || []);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  // boot + polling da lista/heartbeat
  useEffect(() => {
    loadGoals();
    loadHeartbeat();
    const id = setInterval(() => { loadGoals(); loadHeartbeat(); }, 4000);
    return () => clearInterval(id);
  }, [loadGoals, loadHeartbeat]);

  // polling do detalhe quando a missão selecionada está ativa
  useEffect(() => {
    if (!selectedId) return;
    loadDetail(selectedId);
    const id = setInterval(() => {
      setGoal((g) => {
        if (g && !ACTIVE.has(g.status)) return g; // parou: pode deixar de bater
        loadDetail(selectedId);
        return g;
      });
    }, 1500);
    return () => clearInterval(id);
  }, [selectedId, loadDetail]);

  // auto-scroll do trail
  useEffect(() => {
    if (trailRef.current) trailRef.current.scrollTop = trailRef.current.scrollHeight;
  }, [steps.length]);

  async function launch() {
    if (!title.trim() || launching) return;
    setLaunching(true);
    setError(null);
    try {
      const created = await api<{ goal: Goal }>('/api/tars/goals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, description, definition_of_done: dod, run: false }),
      });
      const id = created.goal.id;
      await api(`/api/tars/goals/${id}/start`, { method: 'POST' });
      setSelectedId(id);
      setTitle(''); setDescription(''); setDod('');
      loadGoals();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLaunching(false);
    }
  }

  async function cancelGoal(id: string) {
    try { await api(`/api/tars/goals/${id}/cancel`, { method: 'POST' }); loadDetail(id); loadGoals(); } catch { /* */ }
  }

  async function patchHeartbeat(patch: Partial<Heartbeat>) {
    try {
      const data = await api<{ heartbeat: Heartbeat }>('/api/tars/heartbeat', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
      });
      setHeartbeat(data.heartbeat);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function toggleKill(engage: boolean) {
    try { await api('/api/tars/kill-switch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ engage }) }); loadHeartbeat(); } catch { /* */ }
  }

  const usePreset = (p: typeof PRESETS[number]) => { setTitle(p.title); setDescription(p.description); setDod(p.dod); };

  const sel = goal && goal.id === selectedId ? goal : null;

  return (
    <div className="space-y-8">
      {/* header */}
      <motion.div variants={fadeUp} initial="hidden" animate="show" className="mission-shell rounded-lg p-5 sm:p-6">
        <div>
          <div className="panel-kicker">
            <Target className="h-3.5 w-3.5" />
            mission control
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl" style={{ color: theme.text }}>Missões</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed" style={{ color: theme.textSoft }}>
            Dê um objetivo ao TARS e assista ele executar de forma autônoma: raciocínio, ferramentas e verificação ao vivo.
          </p>
        </div>
      </motion.div>

      {error && <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</div>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        {/* ─── coluna esquerda: compositor + lista + heartbeat ─── */}
        <div className="space-y-5">
          {/* compositor */}
          <motion.div variants={fadeUp} initial="hidden" animate="show" className="void-panel rounded-2xl p-5">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: theme.textMute }}>
              <Rocket className="w-3.5 h-3.5" /> nova missão
            </div>
            <div className="mt-4 space-y-3">
              <input
                value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="Objetivo (ex: gerar uma imagem e salvar no Desktop)"
                className="w-full rounded-xl border bg-black/25 px-4 py-3 text-sm outline-none transition focus:border-white/25"
                style={{ color: theme.text, borderColor: theme.border }}
              />
              <textarea
                value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Descrição / contexto — o que fazer, com quais ferramentas, onde salvar…"
                rows={3}
                className="w-full resize-y rounded-xl border bg-black/25 px-4 py-3 text-sm outline-none transition focus:border-white/25"
                style={{ color: theme.textSoft, borderColor: theme.border }}
              />
              <textarea
                value={dod} onChange={(e) => setDod(e.target.value)}
                placeholder="Critério de sucesso (definition of done) — como saber que terminou de verdade"
                rows={2}
                className="w-full resize-y rounded-xl border bg-black/25 px-4 py-3 text-sm outline-none transition focus:border-white/25"
                style={{ color: theme.textSoft, borderColor: theme.border }}
              />
              <div className="flex flex-wrap items-center gap-2">
                {PRESETS.map((p) => (
                  <button key={p.label} type="button" onClick={() => usePreset(p)}
                    className="rounded-lg border px-2.5 py-1.5 text-[11px] transition hover:bg-white/[0.04]"
                    style={{ borderColor: theme.border, color: theme.textMute }}>
                    {p.label}
                  </button>
                ))}
                <button type="button" onClick={launch} disabled={!title.trim() || launching}
                  className="btn-rift ml-auto inline-flex items-center gap-2">
                  {launching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                  Lançar missão
                </button>
              </div>
            </div>
          </motion.div>

          {/* heartbeat */}
          <motion.div variants={fadeUp} initial="hidden" animate="show" className="void-panel rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: theme.textMute }}>
                <Heart className="w-3.5 h-3.5" /> heartbeat — vida proativa
              </div>
              {heartbeat?.kill_switch
                ? <button onClick={() => toggleKill(false)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 bg-red-400/10 px-2.5 py-1 text-[11px] text-red-200"><Octagon className="w-3 h-3" /> kill-switch ON</button>
                : <button onClick={() => toggleKill(true)} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px]" style={{ borderColor: theme.border, color: theme.textMute }}><Octagon className="w-3 h-3" /> kill-switch</button>}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {([['enabled', 'ligado'], ['auto_run', 'auto-run'], ['allow_proposals', 'propõe']] as const).map(([key, label]) => {
                const on = Boolean(heartbeat?.[key]);
                return (
                  <button key={key} onClick={() => patchHeartbeat({ [key]: !on })}
                    className="rounded-xl border px-3 py-2.5 text-left transition"
                    style={{ borderColor: on ? theme.borderActive : theme.border, background: on ? 'rgba(84,214,164,0.07)' : 'transparent' }}>
                    <div className="text-[10px] uppercase tracking-wider" style={{ color: theme.textGhost }}>{label}</div>
                    <div className="mt-0.5 text-sm font-semibold" style={{ color: on ? theme.tethered : theme.textMute }}>{on ? 'on' : 'off'}</div>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-2 text-[11px]" style={{ color: theme.textGhost }}>
              <Activity className="w-3 h-3" /> {heartbeat?.beats ?? 0} batidas · {heartbeat?.last_action || 'ocioso'}
            </div>
          </motion.div>

          {/* lista de missões */}
          <motion.div variants={fadeUp} initial="hidden" animate="show" className="void-panel rounded-2xl p-5">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: theme.textMute }}>
              <Hash className="w-3.5 h-3.5" /> missões ({goals.length})
            </div>
            <div className="mt-4 space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {goals.length === 0 && <div className="py-8 text-center text-xs" style={{ color: theme.textGhost }}>nenhuma missão ainda — lance a primeira acima</div>}
              {goals.map((g) => {
                const st = statusStyle(g.status);
                const active = selectedId === g.id;
                return (
                  <button key={g.id} onClick={() => setSelectedId(g.id)}
                    className="w-full rounded-xl border p-3 text-left transition"
                    style={{ borderColor: active ? theme.borderActive : theme.border, background: active ? 'rgba(223,230,238,0.045)' : 'transparent' }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="truncate text-sm font-medium" style={{ color: theme.text }}>{g.title}</div>
                      <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider" style={{ color: st.color, background: st.bg }}>
                        {st.pulse && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: st.color }} />}
                        {st.label}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[10px] font-mono" style={{ color: theme.textGhost }}>
                      <span>{g.origin || 'human'}</span>
                      <span>· {g.iterations ?? 0} iters</span>
                      <span>· {g.tool_calls ?? 0} tools</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </div>

        {/* ─── coluna direita: detalhe da missão + trail ao vivo ─── */}
        <motion.div variants={fadeUp} initial="hidden" animate="show" className="void-panel rounded-2xl p-5 flex flex-col">
          {!sel ? (
            <div className="flex flex-1 min-h-[400px] items-center justify-center text-center text-sm" style={{ color: theme.textGhost }}>
              <div>
                <Target className="mx-auto mb-3 w-8 h-8 opacity-40" />
                selecione uma missão para acompanhar o raciocínio do TARS ao vivo
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {(() => { const st = statusStyle(sel.status); return (
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-wider" style={{ color: st.color, background: st.bg }}>
                        {st.pulse && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: st.color }} />}{st.label}
                      </span>); })()}
                    <span className="text-[10px] font-mono" style={{ color: theme.textGhost }}>{sel.id.slice(0, 8)}</span>
                  </div>
                  <h2 className="mt-2 text-lg font-semibold" style={{ color: theme.text }}>{sel.title}</h2>
                </div>
                {ACTIVE.has(sel.status) && (
                  <button onClick={() => cancelGoal(sel.id)} className="btn-rift inline-flex items-center gap-1.5 shrink-0" title="Cancelar">
                    <Square className="w-3.5 h-3.5" /> cancelar
                  </button>
                )}
              </div>

              {sel.definition_of_done && (
                <div className="mt-3 rounded-xl border p-3 text-xs leading-relaxed" style={{ borderColor: theme.border, color: theme.textSoft }}>
                  <span className="uppercase tracking-wider text-[10px]" style={{ color: theme.textGhost }}>critério de sucesso · </span>{sel.definition_of_done}
                </div>
              )}

              <div className="mt-3 grid grid-cols-3 gap-2">
                {[['iterações', `${sel.iterations ?? 0}/${sel.max_iterations ?? '–'}`], ['ferramentas', String(sel.tool_calls ?? 0)], ['tokens', String(sel.tokens_used ?? 0)]].map(([l, v]) => (
                  <div key={l} className="rounded-xl border p-2.5" style={{ borderColor: theme.border }}>
                    <div className="text-[10px] uppercase tracking-wider" style={{ color: theme.textGhost }}>{l}</div>
                    <div className="mt-0.5 text-sm font-semibold" style={{ color: theme.text }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* trail ao vivo */}
              <div className="mt-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: theme.textMute }}>
                <Activity className="w-3.5 h-3.5" /> trail de execução
                {ACTIVE.has(sel.status) && <Loader2 className="w-3 h-3 animate-spin" />}
              </div>
              <div ref={trailRef} className="mt-3 flex-1 min-h-[260px] max-h-[440px] space-y-2 overflow-y-auto rounded-xl border bg-black/20 p-3" style={{ borderColor: theme.border }}>
                {steps.length === 0 && <div className="py-8 text-center text-xs" style={{ color: theme.textGhost }}>aguardando o primeiro passo…</div>}
                {steps.map((s) => {
                  const meta = phaseMeta(s.phase);
                  const Icon = meta.icon;
                  const open = expanded[s.idx];
                  const hasDetail = s.thought || s.tool_input != null || s.observation != null;
                  return (
                    <div key={s.idx} className="rounded-lg border" style={{ borderColor: theme.border, background: 'rgba(255,255,255,0.012)' }}>
                      <button onClick={() => setExpanded((e) => ({ ...e, [s.idx]: !e[s.idx] }))} className="flex w-full items-center gap-2 px-3 py-2 text-left">
                        <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: meta.color }} />
                        <span className="text-[11px] font-mono shrink-0" style={{ color: theme.textGhost }}>#{s.idx}</span>
                        <span className="text-xs font-medium" style={{ color: theme.textSoft }}>{s.action || s.phase}</span>
                        {!s.ok && <XCircle className="w-3 h-3 text-red-300" />}
                        {s.elapsed_ms ? <span className="ml-auto text-[10px] font-mono" style={{ color: theme.textGhost }}>{s.elapsed_ms}ms</span> : <span className="ml-auto" />}
                        {hasDetail && (open ? <ChevronDown className="w-3.5 h-3.5" style={{ color: theme.textGhost }} /> : <ChevronRight className="w-3.5 h-3.5" style={{ color: theme.textGhost }} />)}
                      </button>
                      {open && hasDetail && (
                        <div className="space-y-2 border-t px-3 py-2" style={{ borderColor: theme.border }}>
                          {s.thought && <div className="text-xs italic leading-relaxed" style={{ color: theme.textMute }}>{s.thought}</div>}
                          {s.tool_input != null && (
                            <pre className="overflow-auto rounded bg-black/30 p-2 text-[10px]" style={{ color: theme.textSoft }}>{pretty(s.tool_input)}</pre>
                          )}
                          {s.observation != null && (
                            <pre className="max-h-48 overflow-auto rounded bg-black/30 p-2 text-[10px]" style={{ color: theme.textSoft }}>{pretty(s.observation).slice(0, 4000)}</pre>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* resultado + verificador */}
              {sel.result && (
                <div className="mt-4 rounded-xl border p-3" style={{ borderColor: theme.border }}>
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: theme.textMute }}>
                    <Bot className="w-3.5 h-3.5" /> resultado
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed" style={{ color: theme.textSoft }}>{sel.result}</div>
                </div>
              )}
              {sel.verifier && (
                <div className="mt-3 rounded-xl border p-3" style={{ borderColor: sel.verifier.passed ? 'rgba(84,214,164,0.25)' : 'rgba(232,116,107,0.25)', background: sel.verifier.passed ? 'rgba(84,214,164,0.06)' : 'rgba(232,116,107,0.06)' }}>
                  <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: sel.verifier.passed ? theme.tethered : theme.severed }}>
                    {sel.verifier.passed ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    verificador {sel.verifier.passed ? 'aprovou' : 'reprovou'}
                  </div>
                  {sel.verifier.reason && <div className="mt-1.5 text-xs leading-relaxed" style={{ color: theme.textMute }}>{sel.verifier.reason}</div>}
                </div>
              )}
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
