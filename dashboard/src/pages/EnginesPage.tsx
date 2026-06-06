import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  Cpu,
  FlaskConical,
  Gauge,
  Loader2,
  RefreshCw,
  Router,
  Search,
  Zap,
} from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

interface EngineModel {
  id: string;
  provider: string;
  provider_label?: string;
  model: string;
  label: string;
  owned_by?: string | null;
  available: boolean;
  source?: string;
}

interface EnginesResponse {
  active?: {
    model?: string;
    provider?: string | null;
    send_model?: string;
    persona?: string;
  };
  providers?: Record<string, boolean>;
  models?: EngineModel[];
  count?: number;
  errors?: Record<string, string>;
}

interface SmokeResult {
  ok?: boolean;
  provider?: string;
  model?: string;
  response_preview?: string;
  elapsed_ms?: number;
  error?: string;
  status?: string;
}

const providerOrder = ['all', 'glm', 'kimi', 'ninerouter', 'anthropic', 'openrouter'];

function providerLabel(provider: string) {
  if (provider === 'all') return 'Todos';
  if (provider === 'glm') return 'GLM';
  if (provider === 'kimi') return 'Kimi';
  if (provider === 'ninerouter') return '9Router';
  if (provider === 'anthropic') return 'Anthropic';
  if (provider === 'openrouter') return 'OpenRouter';
  return provider;
}

function toneClass(ok?: boolean) {
  if (ok === true) return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200';
  if (ok === false) return 'border-red-400/25 bg-red-400/10 text-red-200';
  return 'border-white/10 bg-white/[0.03] text-white/55';
}

async function readJson(res: Response) {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || text || `HTTP ${res.status}`);
  return data;
}

export default function EnginesPage() {
  const theme = useTheme();
  const [data, setData] = useState<EnginesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('all');
  const [savingModel, setSavingModel] = useState<string | null>(null);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [smoke, setSmoke] = useState<SmokeResult | null>(null);

  const models = data?.models || [];
  const activeModel = data?.active?.model || '';

  const providers = useMemo(() => {
    const set = new Set(models.map((model) => model.provider).filter(Boolean));
    return providerOrder.filter((item) => item === 'all' || set.has(item));
  }, [models]);

  const filteredModels = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return models.filter((model) => {
      if (provider !== 'all' && model.provider !== provider) return false;
      if (!needle) return true;
      return [
        model.id,
        model.label,
        model.model,
        model.provider,
        model.provider_label,
        model.owned_by,
      ].some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [models, provider, query]);

  const providerStats = useMemo(() => {
    const counts = new Map<string, number>();
    models.forEach((model) => counts.set(model.provider, (counts.get(model.provider) || 0) + 1));
    return counts;
  }, [models]);

  async function loadEngines() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tars/chat/models');
      setData((await readJson(res)) as EnginesResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEngines();
  }, []);

  async function activate(modelId: string) {
    setSavingModel(modelId);
    setError(null);
    setSmoke(null);
    try {
      const res = await fetch('/api/tars/chat/model', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelId }),
      });
      await readJson(res);
      await loadEngines();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingModel(null);
    }
  }

  async function runSmoke(modelId: string) {
    setTestingModel(modelId);
    setSmoke(null);
    setError(null);
    try {
      const res = await fetch('/api/tars/harness/components/ai-smoke/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ live_ai: true, model: modelId, max_tokens: 60 }),
      });
      setSmoke((await readJson(res)) as SmokeResult);
    } catch (err) {
      setSmoke({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTestingModel(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="flex items-center gap-3 text-sm tracking-[0.2em] uppercase" style={{ color: theme.textMute }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          carregando motores
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.header
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mission-shell rounded-lg p-5 sm:p-6"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="panel-kicker">
              <Cpu className="h-3.5 w-3.5" />
              engine matrix
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl" style={{ color: theme.text }}>
              Motores
            </h1>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs" style={{ color: theme.textSoft }}>
                ativo: <span className="font-mono" style={{ color: theme.text }}>{activeModel || 'nenhum'}</span>
              </span>
              <span className={`rounded-lg border px-3 py-2 text-xs ${toneClass(Boolean(data?.active?.provider))}`}>
                {data?.active?.provider || 'sem provider'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {[
              ['modelos', String(data?.count ?? models.length)],
              ['GLM', data?.providers?.glm ? 'on' : 'off'],
              ['Kimi', data?.providers?.kimi ? 'on' : 'off'],
              ['9Router', data?.providers?.ninerouter ? 'on' : 'off'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <div className="text-[9px] uppercase tracking-[0.18em]" style={{ color: theme.textGhost }}>{label}</div>
                <div className="mt-0.5 text-sm font-semibold" style={{ color: theme.text }}>{value}</div>
              </div>
            ))}
            <button
              type="button"
              onClick={loadEngines}
              className="btn-rift inline-flex items-center justify-center gap-2 px-3 py-2 text-xs"
              title="Recarregar motores"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Recarregar
            </button>
          </div>
        </div>
      </motion.header>

      {error && (
        <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {data?.errors && Object.keys(data.errors).length > 0 && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">
          {Object.entries(data.errors).map(([key, value]) => `${key}: ${value}`).join(' · ')}
        </div>
      )}

      <section className="void-panel rounded-lg p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {providers.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setProvider(item)}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  provider === item ? 'bg-white/[0.08] text-white' : 'bg-black/20 text-white/55 hover:text-white/80'
                }`}
                style={{ borderColor: provider === item ? theme.borderActive : theme.border }}
              >
                {providerLabel(item)}
                {item !== 'all' && <span className="ml-2 font-mono text-[10px] opacity-60">{providerStats.get(item) || 0}</span>}
              </button>
            ))}
          </div>

          <label className="relative block w-full lg:w-[360px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/25 py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-emerald-400/40"
              placeholder="buscar modelo"
            />
          </label>
        </div>
      </section>

      {smoke && (
        <section className={`rounded-lg border p-4 ${toneClass(smoke.ok)}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FlaskConical className="h-4 w-4" />
              Smoke test: {smoke.ok ? 'passou' : 'falhou'}
            </div>
            <div className="font-mono text-xs opacity-80">
              {smoke.provider || 'provider'} / {smoke.model || 'modelo'} · {smoke.elapsed_ms ?? 0}ms
            </div>
          </div>
          <div className="mt-2 text-sm opacity-90">
            {smoke.response_preview || smoke.error || smoke.status}
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filteredModels.map((model) => {
          const isActive = model.id === activeModel;
          const isSaving = savingModel === model.id;
          const isTesting = testingModel === model.id;
          return (
            <article
              key={model.id}
              className="instrument-card rounded-lg p-4"
              style={{ borderColor: isActive ? theme.borderActive : theme.border }}
            >
              <div className="flex min-h-[92px] flex-col justify-between gap-3">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold" style={{ color: theme.text }}>
                        {model.label || model.model}
                      </div>
                      <div className="mt-1 truncate font-mono text-[11px]" style={{ color: theme.textGhost }}>
                        {model.id}
                      </div>
                    </div>
                    <div className={`shrink-0 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${toneClass(model.available)}`}>
                      {model.available ? 'online' : 'off'}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-black/20 px-2 py-1 text-[10px] uppercase tracking-[0.12em]" style={{ color: theme.textMute }}>
                      {model.provider === 'ninerouter' ? <Router className="h-3 w-3" /> : <Gauge className="h-3 w-3" />}
                      {providerLabel(model.provider)}
                    </span>
                    {model.owned_by && (
                      <span className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[10px] uppercase tracking-[0.12em]" style={{ color: theme.textMute }}>
                        {model.owned_by}
                      </span>
                    )}
                    {isActive && (
                      <span className="inline-flex items-center gap-1 rounded border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-emerald-200">
                        <Check className="h-3 w-3" />
                        ativo
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => activate(model.id)}
                    disabled={isActive || isSaving || !model.available}
                    className="btn-rift inline-flex min-h-[36px] flex-1 items-center justify-center gap-2 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    {isActive ? 'Ativo' : 'Ativar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => runSmoke(model.id)}
                    disabled={isTesting || !model.available}
                    className="btn-rift inline-flex min-h-[36px] items-center justify-center gap-2 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-45"
                    title="Smoke test"
                  >
                    {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                    Testar
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {filteredModels.length === 0 && (
        <div className="void-panel rounded-lg py-8 text-center text-sm" style={{ color: theme.textMute }}>
          Nenhum motor encontrado.
        </div>
      )}
    </div>
  );
}
