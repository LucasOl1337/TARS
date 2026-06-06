import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, Boxes, Cable, CirclePause, HeartPulse, Target } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const } },
};

type Goal = {
  id: string;
  title: string;
  status: string;
  origin: string;
  iterations: number;
  tool_calls: number;
  updated_at: string;
};

type RuntimeEvent = {
  id: string;
  type: string;
  ts: number;
  timestamp: string;
  goal_id?: string;
  source: string;
  payload?: Record<string, unknown>;
};

type DashboardState = {
  heartbeat: {
    enabled?: boolean;
    auto_run?: boolean;
    allow_proposals?: boolean;
    beats?: number;
    last_action?: string;
    kill_switch?: boolean;
  };
  goals: Goal[];
  events: RuntimeEvent[];
  stats: {
    bridgesOk: number;
    bridgesTotal: number;
    tools: number;
    echoes: number;
    events: number;
  };
};

const initialState: DashboardState = {
  heartbeat: {},
  goals: [],
  events: [],
  stats: { bridgesOk: 0, bridgesTotal: 0, tools: 0, echoes: 0, events: 0 },
};

function timeAgo(ts?: number) {
  if (!ts) return 'sem registro';
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function statusClass(status: string) {
  if (status === 'done') return 'tethered';
  if (['failed', 'cancelled'].includes(status)) return 'severed';
  return 'dormant';
}

export default function Dashboard() {
  const theme = useTheme();
  const [state, setState] = useState<DashboardState>(initialState);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function readJson(path: string) {
      const res = await fetch(path);
      return res.ok ? res.json() : null;
    }

    async function load() {
      try {
        const [heartbeat, goals, events, bridges, echoes, tools] = await Promise.all([
          readJson('/api/tars/heartbeat'),
          readJson('/api/tars/goals?limit=6'),
          readJson('/api/tars/events?limit=10'),
          readJson('/api/tars/tethers/status'),
          readJson('/api/tars/echoes/summary'),
          readJson('/api/tars/tools'),
        ]);
        if (cancelled) return;

        const bridgeRows = Array.isArray(bridges?.tethers) ? bridges.tethers : [];
        const eventRows = Array.isArray(events?.events) ? events.events : [];
        setState({
          heartbeat: heartbeat?.heartbeat ?? {},
          goals: Array.isArray(goals?.goals) ? goals.goals : [],
          events: eventRows,
          stats: {
            bridgesOk: bridgeRows.filter((item: { ok?: boolean }) => item.ok).length,
            bridgesTotal: bridgeRows.length,
            tools: Number(tools?.count ?? tools?.tools?.length ?? 0),
            echoes: Number(echoes?.total ?? 0),
            events: Number(events?.summary?.total ?? eventRows.length),
          },
        });
      } catch {
        if (!cancelled) setState(initialState);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const id = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const activeGoals = useMemo(
    () => state.goals.filter((goal) => ['pending', 'running', 'verifying'].includes(goal.status)).length,
    [state.goals],
  );

  const heartbeatState = state.heartbeat.kill_switch
    ? 'kill-switch'
    : state.heartbeat.enabled
      ? 'ativo'
      : 'desligado';

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show" className="space-y-5">
      <header className="mission-shell rounded-lg p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="panel-kicker">
              <Activity className="h-3.5 w-3.5" />
              runtime core
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl" style={{ color: theme.text }}>
              TARS Operational Dimension
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: theme.textSoft }}>
              Estado operacional, fila de objetivos, pontes e eventos persistidos em um painel de missão contínua.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[420px]">
            {[
              ['heartbeat', heartbeatState],
              ['goals', String(activeGoals)],
              ['bridges', `${state.stats.bridgesOk}/${state.stats.bridgesTotal}`],
              ['polling', '10s'],
            ].map(([label, value]) => (
              <div key={label} className="mono-stat">
                <div className="text-[10px] uppercase" style={{ color: theme.textGhost }}>{label}</div>
                <div className="mt-1 truncate text-lg font-semibold" style={{ color: theme.text }}>{loading ? '...' : value}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: 'Heartbeat', value: heartbeatState, icon: HeartPulse },
          { label: 'Goals ativos', value: String(activeGoals), icon: Target },
          { label: 'Eventos', value: String(state.stats.events), icon: Activity },
          { label: 'Tools', value: String(state.stats.tools), icon: Boxes },
          { label: 'Bridges', value: `${state.stats.bridgesOk}/${state.stats.bridgesTotal}`, icon: Cable },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="instrument-card rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: theme.textMute }}>
                  {item.label}
                </span>
                <Icon className="h-4 w-4" style={{ color: theme.sharinganDeep }} />
              </div>
              <div className="mt-3 truncate text-2xl font-semibold" style={{ color: theme.text }}>
                {loading ? '...' : item.value}
              </div>
            </div>
          );
        })}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="void-panel rounded-lg p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: theme.textSoft }}>
                Objetivos recentes
              </h2>
            </div>
            <span className="state-badge dormant">{state.heartbeat.auto_run ? 'auto-run' : 'manual'}</span>
          </div>

          <div className="space-y-2">
            {state.goals.length === 0 ? (
              <div className="flex items-center gap-2 py-8 text-sm" style={{ color: theme.textMute }}>
                <CirclePause className="h-4 w-4" />
                nenhum objetivo registrado
              </div>
            ) : (
              state.goals.map((goal) => (
                <div
                  key={goal.id}
                  className="grid grid-cols-[1fr_auto] gap-3 border-t py-3 first:border-t-0 first:pt-0"
                  style={{ borderColor: theme.border }}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium" style={{ color: theme.text }}>
                      {goal.title}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: theme.textMute }}>
                      <span>{goal.origin}</span>
                      <span>iter {goal.iterations}</span>
                      <span>tools {goal.tool_calls}</span>
                    </div>
                  </div>
                  <span className={`state-badge ${statusClass(goal.status)}`}>{goal.status}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="void-panel rounded-lg p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em]" style={{ color: theme.textSoft }}>
              Event stream
            </h2>
            <span className="text-xs font-mono" style={{ color: theme.textGhost }}>
              {state.stats.echoes} echoes
            </span>
          </div>

          <div className="space-y-0">
            {state.events.length === 0 ? (
              <div className="flex items-center gap-2 py-8 text-sm" style={{ color: theme.textMute }}>
                <CirclePause className="h-4 w-4" />
                nenhum evento persistido
              </div>
            ) : (
              state.events.map((event) => (
                <div
                  key={event.id}
                  className="grid grid-cols-[70px_1fr_auto] items-center gap-3 border-t py-3 first:border-t-0 first:pt-0"
                  style={{ borderColor: theme.border }}
                >
                  <span className="text-xs font-mono" style={{ color: theme.textGhost }}>
                    {timeAgo(event.ts)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium" style={{ color: theme.text }}>
                      {event.type}
                    </div>
                    <div className="mt-1 truncate text-xs" style={{ color: theme.textMute }}>
                      {event.goal_id ? `goal ${event.goal_id.slice(0, 8)}` : event.source}
                    </div>
                  </div>
                  <span className="text-xs font-mono" style={{ color: theme.textGhost }}>
                    {event.source}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </motion.div>
  );
}
