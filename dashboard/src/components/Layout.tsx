import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Aperture,
  User,
  ChevronLeft,
  ChevronRight,
  Plug2,
  Mic,
  Wrench,
  Target,
} from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import KamuiVoid from './KamuiVoid';

export type PageId = 'dimension' | 'missions' | 'endpoints' | 'tools' | 'persona' | 'voice';

interface LayoutProps {
  activePage: PageId;
  onPageChange: (page: PageId) => void;
  children: React.ReactNode;
}

interface NavItem {
  id: PageId;
  label: string;
  icon: React.ElementType;
  hint: string;
}

const navItems: NavItem[] = [
  { id: 'dimension', label: 'Dimension', icon: Aperture, hint: 'overview do vazio' },
  { id: 'missions',  label: 'Missões',   icon: Target,   hint: 'dê um objetivo e assista o TARS executar de forma autônoma' },
  { id: 'endpoints', label: 'Endpoints', icon: Plug2,    hint: 'entradas e saídas de cada módulo' },
  { id: 'tools',     label: 'Ferramentas', icon: Wrench, hint: 'arsenal de tools, contratos e chat de teste' },
  { id: 'persona',   label: 'Persona',   icon: User,     hint: 'escolha a persona do Yume para o TARS' },
  { id: 'voice',     label: 'Voz',       icon: Mic,      hint: 'presença de voz + detector de necessidade de fala' },
];

export default function Layout({ activePage, onPageChange, children }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [hubOk, setHubOk] = useState<boolean | null>(null);
  const theme = useTheme();

  useEffect(() => {
    let cancelled = false;
    async function checkHub() {
      try {
        const res = await fetch('/api/tars/health');
        const data = res.ok ? await res.json() : null;
        if (!cancelled) setHubOk(Boolean(data?.ok));
      } catch {
        if (!cancelled) setHubOk(false);
      }
    }
    checkHub();
    const id = setInterval(checkHub, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div
      className="flex h-screen w-screen overflow-hidden relative"
      style={{ background: theme.void }}
    >
      {/* ─── Fundo dimensional: chakra distante, quase imperceptível ─── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-[-15%] left-[5%] w-[700px] h-[700px] rounded-full opacity-[0.022]"
          style={{
            background: `radial-gradient(circle, ${theme.sharingan}, transparent 65%)`,
            filter: 'blur(140px)',
          }}
        />
        <div
          className="absolute bottom-[-20%] right-[-5%] w-[600px] h-[600px] rounded-full opacity-[0.018]"
          style={{
            background: `radial-gradient(circle, ${theme.rift}, transparent 70%)`,
            filter: 'blur(140px)',
          }}
        />
        {/* grid sutil — sensação de espaço cartografado */}
        <div
          className="absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage:
              `linear-gradient(rgba(223,230,238,0.018) 1px, transparent 1px),
               linear-gradient(90deg, rgba(223,230,238,0.018) 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
            maskImage: 'radial-gradient(circle at center, black 25%, transparent 80%)',
            WebkitMaskImage: 'radial-gradient(circle at center, black 25%, transparent 80%)',
          }}
        />
      </div>

      {/* ─── Sidebar ─── */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 76 : 240 }}
        transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
        className="relative flex flex-col h-full shrink-0 z-20 border-r"
        style={{
          background: `linear-gradient(180deg, ${theme.void2} 0%, ${theme.void} 100%)`,
          borderColor: theme.border,
        }}
      >
        {/* Brand */}
        <div
          className="flex items-center gap-3 px-4 h-16 border-b shrink-0"
          style={{ borderColor: theme.border }}
        >
          <div className="relative w-10 h-10 shrink-0">
            <KamuiVoid size={40} />
          </div>

          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.22 }}
                className="flex flex-col"
              >
                <h1 className="text-base font-bold tracking-[0.3em] sharingan-text">TARS</h1>
                <span
                  className="text-[9px] tracking-[0.35em] uppercase"
                  style={{ color: theme.textGhost }}
                >
                  companion
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onPageChange(item.id)}
                className={`rift-item w-full ${isActive ? 'active' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                <AnimatePresence>
                  {!collapsed && (
                    <motion.span
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -6 }}
                      transition={{ duration: 0.18 }}
                      className="whitespace-nowrap flex-1 text-left"
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            );
          })}
        </nav>

        {/* Footer — status do hub */}
        <div className="px-3 py-3 border-t" style={{ borderColor: theme.border }}>
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded-lg ${collapsed ? 'justify-center' : ''}`}
            style={{ background: 'rgba(223, 230, 238, 0.025)', border: `1px solid ${theme.border}` }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: hubOk === false ? theme.severed : theme.sharingan, opacity: 0.7 }}
            />
            <AnimatePresence>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-[10px] font-medium tracking-wider uppercase"
                  style={{ color: theme.textMute }}
                >
                  {hubOk === false ? 'TARS offline' : hubOk === null ? 'checando TARS' : 'TARS online'}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer border z-30 transition-all hover:scale-110"
          style={{
            background: theme.void2,
            borderColor: theme.border,
          }}
        >
          {collapsed ? (
            <ChevronRight className="w-3 h-3" style={{ color: theme.sharingan }} />
          ) : (
            <ChevronLeft className="w-3 h-3" style={{ color: theme.sharingan }} />
          )}
        </button>
      </motion.aside>

      {/* ─── Main ─── */}
      <main className="flex-1 overflow-hidden relative z-10 flex flex-col">
        {/* topbar */}
        <div
          className="flex items-center justify-between gap-3 px-6 h-14 shrink-0 border-b"
          style={{ borderColor: theme.border }}
        >
          <div className="flex items-center gap-3">
            <span
              className="text-[11px] font-medium tracking-[0.25em] uppercase"
              style={{ color: theme.textMute }}
            >
              {navItems.find(n => n.id === activePage)?.hint}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono" style={{ color: theme.textGhost }}>
            <span>127.0.0.1 : 62025</span>
          </div>
        </div>

        {/* page */}
        <div className="flex-1 overflow-y-auto">
          <motion.div
            key={activePage}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="px-8 py-8 max-w-[1400px] mx-auto"
          >
            {children}
          </motion.div>
        </div>
      </main>
    </div>
  );
}
