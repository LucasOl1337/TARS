import { useMemo } from 'react';

/**
 * TARS core — o motivo de marca do companion (substitui o Sharingan do template).
 *
 * Em vez de um olho, um instrumento orbital: um monolito central (a inteligência
 * de bordo) cercado por anéis orbitais técnicos em branco-aço Asiimov, com nós
 * de telemetria deslizando nas órbitas e detritos flutuando no vácuo.
 *
 * Camadas (de fora pra dentro):
 *  - halo frio difuso (respirando);
 *  - anéis orbitais girando devagar (instrumento);
 *  - retícula de HUD (cruz + ticks);
 *  - órbitas com nós de telemetria;
 *  - monolito central (núcleo da inteligência) com brilho de aço;
 *  - partículas (detritos no vácuo).
 *
 * SVG + Tailwind keyframes. Zero dependência extra.
 */

interface KamuiVoidProps {
  /** Tamanho em px (quadrado). Default: 320 */
  size?: number;
}

const VB = 200;
const C = VB / 2; // 100

const ORBITS = [
  { r: 78, dur: 'animate-spiral-slow', dash: '2 6', op: 0.30 },
  { r: 64, dur: 'animate-spiral-reverse', dash: '1 5', op: 0.22 },
  { r: 50, dur: 'animate-spiral-slow', dash: '3 7', op: 0.18 },
];

// Nós de telemetria — posições angulares fixas em cada órbita.
const NODES = [
  { r: 78, angle: 18 },
  { r: 78, angle: 205 },
  { r: 64, angle: 110 },
  { r: 50, angle: 300 },
];

export default function KamuiVoid({ size = 320 }: KamuiVoidProps) {
  // Partículas flutuando como detritos no vácuo.
  const particles = useMemo(() => {
    return Array.from({ length: 22 }).map((_, i) => {
      const angle = (i / 22) * Math.PI * 2 + Math.random() * 0.4;
      const radius = 86 + Math.random() * 26;
      const x = C + Math.cos(angle) * radius;
      const y = C + Math.sin(angle) * radius;
      const delay = Math.random() * 12;
      const dur = 16 + Math.random() * 16;
      const op = 0.12 + Math.random() * 0.3;
      const r = 0.5 + Math.random() * 1.1;
      return { x, y, delay, dur, op, r, id: i };
    });
  }, []);

  // Ticks da retícula de HUD ao redor do núcleo.
  const ticks = useMemo(() => {
    return Array.from({ length: 36 }).map((_, i) => {
      const a = (i / 36) * Math.PI * 2;
      const inner = i % 3 === 0 ? 40 : 43;
      const outer = 46;
      return {
        x1: C + Math.cos(a) * inner, y1: C + Math.sin(a) * inner,
        x2: C + Math.cos(a) * outer, y2: C + Math.sin(a) * outer,
        major: i % 3 === 0, id: i,
      };
    });
  }, []);

  return (
    <div
      className="relative select-none pointer-events-none"
      style={{ width: size, height: size }}
    >
      {/* halo frio difuso — respirando */}
      <div
        className="absolute rounded-full animate-breathe"
        style={{
          inset: '-12%',
          background:
            'radial-gradient(circle at 50% 50%, rgba(223,230,238,0.16) 0%, rgba(136,147,165,0.08) 32%, rgba(136,147,165,0.03) 56%, transparent 72%)',
          filter: 'blur(24px)',
        }}
      />

      {/* anéis orbitais externos girando */}
      {ORBITS.map((o, i) => (
        <svg
          key={o.r}
          viewBox={`0 0 ${VB} ${VB}`}
          className={`absolute inset-0 w-full h-full ${o.dur} overflow-visible`}
          style={{ transformOrigin: `${C}px ${C}px` }}
        >
          <circle
            cx={C} cy={C} r={o.r}
            fill="none"
            stroke="rgba(223,230,238,0.5)"
            strokeWidth={i === 0 ? 0.7 : 0.5}
            strokeDasharray={o.dash}
            opacity={o.op}
          />
        </svg>
      ))}

      {/* núcleo: retícula HUD + monolito */}
      <svg viewBox={`0 0 ${VB} ${VB}`} className="absolute inset-0 w-full h-full">
        <defs>
          <radialGradient id="tars-core" cx="42%" cy="36%" r="72%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="40%" stopColor="#dfe6ee" />
            <stop offset="78%" stopColor="#9aa6b4" />
            <stop offset="100%" stopColor="#5b6573" />
          </radialGradient>
          <radialGradient id="tars-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(223,230,238,0.35)" />
            <stop offset="60%" stopColor="rgba(223,230,238,0.06)" />
            <stop offset="100%" stopColor="rgba(223,230,238,0)" />
          </radialGradient>
          <linearGradient id="tars-mono" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f3f6fa" />
            <stop offset="50%" stopColor="#c2cad6" />
            <stop offset="100%" stopColor="#7e8a99" />
          </linearGradient>
        </defs>

        {/* halo do núcleo */}
        <circle cx={C} cy={C} r={46} fill="url(#tars-glow)" />

        {/* retícula HUD — ticks radiais */}
        <g>
          {ticks.map((t) => (
            <line
              key={t.id}
              x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
              stroke="rgba(223,230,238,0.55)"
              strokeWidth={t.major ? 0.8 : 0.4}
              opacity={t.major ? 0.5 : 0.28}
            />
          ))}
        </g>

        {/* cruz da retícula */}
        <line x1={C} y1={C - 52} x2={C} y2={C - 36} stroke="rgba(223,230,238,0.4)" strokeWidth={0.5} />
        <line x1={C} y1={C + 36} x2={C} y2={C + 52} stroke="rgba(223,230,238,0.4)" strokeWidth={0.5} />
        <line x1={C - 52} y1={C} x2={C - 36} y2={C} stroke="rgba(223,230,238,0.4)" strokeWidth={0.5} />
        <line x1={C + 36} y1={C} x2={C + 52} y2={C} stroke="rgba(223,230,238,0.4)" strokeWidth={0.5} />

        {/* anel interno fino */}
        <circle cx={C} cy={C} r={32} fill="none" stroke="rgba(223,230,238,0.22)" strokeWidth={0.6} />

        {/* monolito central — a inteligência de bordo (homenagem ao TARS de Interstellar) */}
        <g style={{ transformOrigin: `${C}px ${C}px` }}>
          <rect
            x={C - 9} y={C - 22} width={18} height={44} rx={2.5}
            fill="url(#tars-mono)"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth={0.6}
          />
          {/* juntas dos segmentos do monolito */}
          {[-11, 0, 11].map((dy) => (
            <line
              key={dy}
              x1={C - 9} y1={C + dy} x2={C + 9} y2={C + dy}
              stroke="rgba(60,70,82,0.55)" strokeWidth={0.5}
            />
          ))}
          {/* reflexo de aço */}
          <rect x={C - 6} y={C - 19} width={3} height={38} rx={1.5} fill="rgba(255,255,255,0.35)" />
        </g>
      </svg>

      {/* nós de telemetria deslizando nas órbitas */}
      <svg
        viewBox={`0 0 ${VB} ${VB}`}
        className="absolute inset-0 w-full h-full animate-spiral-slow overflow-visible"
        style={{ transformOrigin: `${C}px ${C}px` }}
      >
        {NODES.map((n, i) => {
          const a = (n.angle / 180) * Math.PI;
          const x = C + Math.cos(a) * n.r;
          const y = C + Math.sin(a) * n.r;
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={2.6} fill="rgba(223,230,238,0.12)" />
              <circle cx={x} cy={y} r={1.3} fill="#eef2f7" opacity={0.9} />
            </g>
          );
        })}
      </svg>

      {/* partículas flutuantes — detritos no vácuo */}
      <svg viewBox={`0 0 ${VB} ${VB}`} className="absolute inset-0 w-full h-full overflow-visible">
        {particles.map((p) => (
          <circle
            key={p.id}
            cx={p.x}
            cy={p.y}
            r={p.r}
            fill="#eef2f7"
            opacity={p.op * 0.55}
            style={{
              animation: `drift ${p.dur}s ease-in-out ${p.delay}s infinite`,
              transformOrigin: `${p.x}px ${p.y}px`,
            }}
          />
        ))}
      </svg>
    </div>
  );
}
