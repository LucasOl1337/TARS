import { useEffect, useState } from 'react';
import { User, Check, Plus } from 'lucide-react';

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
      <div className="flex items-center justify-center h-64">
        <div className="text-sm tracking-widest uppercase text-white/50">carregando personas do Yume…</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <User className="w-5 h-5" />
          <h1 className="text-2xl font-semibold tracking-[0.2em]">Persona</h1>
        </div>
        <p className="text-sm text-white/60">Escolha qual persona do Yume o TARS deve usar como cérebro.</p>
      </div>

      {/* Active Persona */}
      <div className="rounded-xl border border-white/10 bg-white/[0.015] p-6">
        <div className="text-xs uppercase tracking-[0.3em] text-white/40 mb-3">Persona Ativa</div>
        {active?.persona ? (
          <div className="flex items-start justify-between">
            <div>
              <div className="text-lg font-medium">{active.persona.name}</div>
              <div className="text-sm text-white/60 mt-1">{active.persona.role || active.slug}</div>
              {active.persona.tone && (
                <div className="text-xs text-white/40 mt-2">tom: {active.persona.tone}</div>
              )}
            </div>
            <div className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs flex items-center gap-1">
              <Check className="w-3 h-3" /> ATIVO
            </div>
          </div>
        ) : (
          <div className="text-white/50 text-sm">Nenhuma persona ativa. Selecione abaixo ou crie "tars".</div>
        )}
        {active?.error && <div className="text-red-400 text-xs mt-2">Erro: {active.error}</div>}
      </div>

      {/* Personas List */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs uppercase tracking-[0.3em] text-white/40">Personas Disponíveis no Yume</div>
          <button
            onClick={() => window.location.reload()}
            className="text-xs px-3 py-1 rounded border border-white/10 hover:bg-white/5"
          >
            Recarregar
          </button>
        </div>

        {personas.length === 0 ? (
          <div className="text-white/50 text-sm py-8 text-center border border-white/10 rounded-xl">
            Nenhuma persona encontrada no Yume.<br />
            Crie a persona "tars" primeiro.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {personas.map((p) => {
              const isActive = active?.slug === p.slug;
              return (
                <button
                  key={p.slug}
                  onClick={() => selectPersona(p.slug)}
                  className={`text-left p-5 rounded-xl border transition-all ${
                    isActive
                      ? 'border-emerald-500/50 bg-emerald-500/5'
                      : 'border-white/10 hover:border-white/30 bg-white/[0.01]'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-white/50 mt-1">{p.slug}</div>
                    </div>
                    {isActive && <Check className="w-4 h-4 text-emerald-400" />}
                  </div>
                  {p.role && <div className="text-sm text-white/60 mt-3">{p.role}</div>}
                  {p.tone && <div className="text-xs text-white/40 mt-1">tom: {p.tone}</div>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && <div className="text-red-400 text-xs">Erro: {error}</div>}
    </div>
  );
}
