import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Cable, Boxes, Activity, Sparkles } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import KamuiVoid from '@/components/KamuiVoid';

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] as const } },
};

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

export default function Dashboard() {
  const theme = useTheme();
  const [stats, setStats] = useState({ tethersOk: 0, tethersTotal: 5, echoes: 0, tools: 0 });

  useEffect(() => {
    let cancelled = false;
    async function loadStats() {
      try {
        const [tethersRes, echoesRes, toolsRes] = await Promise.all([
          fetch('/api/tars/tethers/status'),
          fetch('/api/tars/echoes/summary'),
          fetch('/api/tars/tools'),
        ]);
        const tethers = tethersRes.ok ? await tethersRes.json() : null;
        const echoes = echoesRes.ok ? await echoesRes.json() : null;
        const tools = toolsRes.ok ? await toolsRes.json() : null;
        if (cancelled) return;
        const rows = Array.isArray(tethers?.tethers) ? tethers.tethers : [];
        setStats({
          tethersOk: rows.filter((t: { ok?: boolean }) => t.ok).length,
          tethersTotal: rows.length || 5,
          echoes: Number(echoes?.total ?? 0),
          tools: Number(tools?.count ?? tools?.tools?.length ?? 0),
        });
      } catch {
        // Mantém os defaults se o backend ainda estiver subindo.
      }
    }
    loadStats();
    const id = setInterval(loadStats, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="space-y-10">
      {/* Hero — o vazio que respira */}
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="relative flex flex-col items-center justify-center pt-8 pb-6"
      >
        <KamuiVoid size={300} />

        <div className="text-center mt-4 -mb-2">
          <h1 className="void-title text-5xl tracking-[0.4em] font-bold">TARS</h1>
          <p
            className="text-[11px] tracking-[0.6em] uppercase mt-3 kanji"
            style={{ color: theme.textGhost }}
          >
            space exploration companion
          </p>
        </div>
      </motion.div>

      {/* Estado da dimensão */}
      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        {[
          {
            icon: Cable,
            label: 'Bridges',
            value: `${stats.tethersOk} / ${stats.tethersTotal}`,
            desc: 'pontes conectadas ao hub',
          },
          {
            icon: Boxes,
            label: 'Arsenal',
            value: String(stats.tools),
            desc: 'ferramentas embutidas',
          },
          {
            icon: Activity,
            label: 'Echoes',
            value: String(stats.echoes),
            desc: 'eventos registrados',
          },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <motion.div key={s.label} variants={fadeUp}>
              <div className="void-panel rounded-2xl p-6 h-full">
                <div className="flex items-start justify-between">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center"
                    style={{
                      background: theme.sharinganSoft,
                      border: `1px solid ${theme.border}`,
                    }}
                  >
                    <Icon className="w-5 h-5" style={{ color: theme.sharingan, opacity: 0.8 }} />
                  </div>
                </div>
                <div className="mt-5">
                  <div
                    className="text-3xl font-bold tracking-tight"
                    style={{ color: theme.text }}
                  >
                    {s.value}
                  </div>
                  <div
                    className="text-[11px] font-semibold tracking-[0.2em] uppercase mt-1.5"
                    style={{ color: theme.textSoft }}
                  >
                    {s.label}
                  </div>
                  <div className="text-xs mt-1" style={{ color: theme.textMute }}>
                    {s.desc}
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Mensagem do vazio */}
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="void-panel rounded-2xl p-8 relative overflow-hidden"
      >
        <div className="relative flex items-start gap-4">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: theme.sharinganSoft, border: `1px solid ${theme.border}` }}
          >
            <Sparkles className="w-4 h-4" style={{ color: theme.sharingan, opacity: 0.8 }} />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold mb-1" style={{ color: theme.text }}>
              {stats.echoes > 0 ? 'O TARS está operando.' : 'O TARS está em standby.'}
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: theme.textSoft }}>
              {stats.echoes > 0
                ? 'Os ecos já estão sendo registrados. Use Echoes para ver os fluxos completos e Bridges para conferir quais pontes estão ativas.'
                : 'Nada atravessou as pontes ainda. Quando Yume e Kamui forem alcançados pelo hub, esta superfície vai refletir tudo que passa por ela.'}
            </p>
            <div className="flex items-center gap-2 mt-4">
              <div className="state-badge dormant">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: theme.textMute }}
                />
                dormente
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
