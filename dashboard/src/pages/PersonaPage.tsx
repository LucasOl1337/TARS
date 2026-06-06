import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2, RefreshCw, ShieldCheck, User } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

interface YumePersona {
  slug: string;
  name: string;
  role?: string;
  tone?: string;
}

interface ActivePersona {
  slug: string;
  persona: YumePersona | null;
  source: string;
  error: string | null;
}

export default function PersonaPage() {
  const theme = useTheme();
  const [personas, setPersonas] = useState<YumePersona[]>([]);
  const [active, setActive] = useState<ActivePersona | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadPersonas() {
    try {
      const res = await fetch('/api/tars/yume/personas');
      const data = await res.json();
      setPersonas(data.personas || []);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function loadActive() {
    try {
      const res = await fetch('/api/tars/persona/active');
      const data = await res.json();
      setActive(data);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function selectPersona(slug: string) {
    try {
      const res = await fetch('/api/tars/persona/active', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadActive();
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    Promise.all([loadPersonas(), loadActive()]).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-3 text-sm uppercase" style={{ color: theme.textMute }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          carregando personas do Yume
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <motion.header
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mission-shell rounded-lg p-5 sm:p-6"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="panel-kicker">
              <User className="h-3.5 w-3.5" />
              persona matrix
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl" style={{ color: theme.text }}>
              Persona
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: theme.textSoft }}>
              Escolha qual persona do Yume o TARS usa como cérebro, tom e identidade operacional.
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="btn-rift inline-flex items-center justify-center gap-2"
            title="Recarregar personas"
          >
            <RefreshCw className="h-4 w-4" />
            Recarregar
          </button>
        </div>
      </motion.header>

      <div className="void-panel rounded-lg p-6">
        <div className="panel-kicker mb-3">
          <ShieldCheck className="h-3.5 w-3.5" />
          persona ativa
        </div>
        {active?.persona ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xl font-semibold" style={{ color: theme.text }}>{active.persona.name}</div>
              <div className="mt-1 text-sm" style={{ color: theme.textSoft }}>{active.persona.role || active.slug}</div>
              {active.persona.tone && (
                <div className="mt-2 text-xs" style={{ color: theme.textMute }}>tom: {active.persona.tone}</div>
              )}
            </div>
            <div className="state-badge tethered flex items-center gap-1">
              <Check className="h-3 w-3" /> ativo
            </div>
          </div>
        ) : (
          <div className="text-sm" style={{ color: theme.textMute }}>Nenhuma persona ativa. Selecione abaixo ou crie "tars".</div>
        )}
        {active?.error && <div className="mt-2 text-xs" style={{ color: theme.severed }}>Erro: {active.error}</div>}
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <div className="panel-kicker">personas disponíveis no Yume</div>
          <div className="text-xs font-mono" style={{ color: theme.textGhost }}>{personas.length} registros</div>
        </div>

        {personas.length === 0 ? (
          <div className="void-panel rounded-lg py-8 text-center text-sm" style={{ color: theme.textMute }}>
            Nenhuma persona encontrada no Yume.<br />
            Crie a persona "tars" primeiro.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {personas.map((p) => {
              const isActive = active?.slug === p.slug;
              return (
                <button
                  key={p.slug}
                  onClick={() => selectPersona(p.slug)}
                  className="instrument-card rounded-lg p-5 text-left transition-all hover:-translate-y-0.5"
                  style={{ borderColor: isActive ? theme.borderActive : theme.border }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium" style={{ color: theme.text }}>{p.name}</div>
                      <div className="mt-1 text-xs font-mono" style={{ color: theme.textGhost }}>{p.slug}</div>
                    </div>
                    {isActive && <Check className="h-4 w-4 shrink-0" style={{ color: theme.tethered }} />}
                  </div>
                  {p.role && <div className="mt-3 text-sm" style={{ color: theme.textSoft }}>{p.role}</div>}
                  {p.tone && <div className="mt-1 text-xs" style={{ color: theme.textMute }}>tom: {p.tone}</div>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && <div className="text-xs" style={{ color: theme.severed }}>Erro: {error}</div>}
    </div>
  );
}
