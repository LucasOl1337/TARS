import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import {
  Globe2,
  MessageSquare,
  Globe,
  Film,
  Mic,
  UserCircle2,
  Brain,
  Boxes,
  Cable,
  Route,
  Box,
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
  Plus,
  Play,
  Loader2,
  Check,
  AlertTriangle,
  ChevronDown,
  Pencil,
} from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

// ─── Shapes vindos do backend (/kamui/endpoints) ─────────────
interface EndpointSpec {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'WS' | 'SSE';
  path: string;
  summary: string;
  examplePayload?: string;
}
interface ModuleSpec {
  id: string;
  label: string;
  desc: string;
  icon: string;           // id da icon (kebab-case) — convertido aqui pra componente
  featured?: boolean;
  outbound: EndpointSpec[];
  inbound: EndpointSpec[];
}
interface CatalogResponse {
  modules: ModuleSpec[];
  generated_at: number;
}
interface KamuiCallResult {
  ok: boolean;
  tether: string;
  endpoint: string;
  status?: number;
  data?: unknown;
  error?: string;
  elapsed_ms: number;
}

/** Mapa kebab-case → componente do lucide-react. */
const ICONS: Record<string, React.ElementType> = {
  'globe-2': Globe2,
  'globe': Globe,
  'message-square': MessageSquare,
  'film': Film,
  'mic': Mic,
  'user-circle-2': UserCircle2,
  'brain': Brain,
  'boxes': Boxes,
  'cable': Cable,
  'route': Route,
};
function iconFor(name: string): React.ElementType {
  return ICONS[name] ?? Box;
}

// ───────── Image upload por card (localStorage por enquanto) ─────────
// TODO: migrar pra DB do Kamui quando endpoint /kamui/module-overrides existir.

function useCardImage(moduleId: string) {
  const KEY = `kamui.cardImage.${moduleId}`;
  const [image, setImageState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try { return localStorage.getItem(KEY); } catch { return null; }
  });
  const setImage = useCallback((data: string | null) => {
    try {
      if (data === null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, data);
    } catch (e) {
      console.warn('[Kamui] localStorage cheio? falha ao salvar foto:', (e as Error).message);
    }
    setImageState(data);
  }, [KEY]);
  return [image, setImage] as const;
}

/**
 * Comprime imagem antes de salvar — protege o localStorage (limite ~5MB por origin)
 * e mantém performance no render.
 */
function compressImage(dataUrl: string, maxSize = 320, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas context unavailable'));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('image load failed'));
    img.src = dataUrl;
  });
}

interface CardAvatarProps {
  moduleId: string;
  icon: React.ElementType;
  size?: 'sm' | 'lg';
  layoutId?: string;
}

function CardAvatar({ moduleId, icon: Icon, size = 'sm', layoutId }: CardAvatarProps) {
  const theme = useTheme();
  const [image, setImage] = useCardImage(moduleId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dim = size === 'lg' ? 'w-16 h-16' : 'w-12 h-12';
  const iconSize = size === 'lg' ? 'w-7 h-7' : 'w-5 h-5';
  const overlayIconSize = size === 'lg' ? 'w-4 h-4' : 'w-3.5 h-3.5';
  const radius = size === 'lg' ? 'rounded-2xl' : 'rounded-xl';

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      try {
        const compressed = await compressImage(dataUrl);
        setImage(compressed);
      } catch {
        setImage(dataUrl);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function triggerUpload(e: React.MouseEvent) {
    e.stopPropagation();
    fileInputRef.current?.click();
  }

  function removeImage(e: React.MouseEvent) {
    e.stopPropagation();
    setImage(null);
  }

  return (
    <motion.div
      layoutId={layoutId}
      className={`relative ${dim} ${radius} overflow-hidden group cursor-pointer shrink-0`}
      style={{
        background: image ? 'rgba(0,0,0,0.4)' : 'rgba(196, 67, 67, 0.06)',
        border: `1px solid ${image ? theme.borderHover : theme.border}`,
      }}
      onClick={triggerUpload}
      title={image ? 'clique pra trocar a foto' : 'clique pra adicionar foto'}
    >
      {image ? (
        <img src={image} alt={moduleId} className="w-full h-full object-cover" draggable={false} />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Icon className={iconSize} style={{ color: theme.sharingan, opacity: 0.8 }} />
        </div>
      )}

      {/* hover overlay */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.55)' }}
      >
        <Pencil className={overlayIconSize} style={{ color: '#fff' }} />
      </div>

      {/* x pra remover */}
      {image && (
        <button
          onClick={removeImage}
          className="absolute top-1 right-1 w-4 h-4 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:scale-110"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          title="remover foto"
        >
          <X className="w-2.5 h-2.5" style={{ color: '#fff' }} />
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleUpload}
        className="hidden"
      />
    </motion.div>
  );
}

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.4, 0, 0.2, 1] as const } },
};
const stagger = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { staggerChildren: 0.05 } },
};

// ───────────────────────── Card ─────────────────────────

interface CardProps {
  module: ModuleSpec;
  onClick: () => void;
}

function StickyCard({ module, onClick }: CardProps) {
  const theme = useTheme();
  const Icon = iconFor(module.icon);
  const totalEndpoints = module.inbound.length + module.outbound.length;

  return (
    <motion.div
      layoutId={`card-${module.id}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      }}
      whileTap={{ scale: 0.985 }}
      className={`sticky-card ${module.featured ? 'featured' : ''} rounded-2xl text-left w-full h-[200px] p-5 flex flex-col cursor-pointer outline-none`}
    >
      <div className="flex items-start justify-between">
        <CardAvatar
          moduleId={module.id}
          icon={Icon}
          size="sm"
          layoutId={`icon-${module.id}`}
        />
      </div>

      <div className="flex-1 flex flex-col justify-center min-h-0">
        <motion.h3
          layoutId={`title-${module.id}`}
          className="text-base font-bold tracking-tight truncate"
          style={{ color: theme.text }}
        >
          {module.label}
        </motion.h3>
        <motion.p
          layoutId={`desc-${module.id}`}
          className="text-[11px] mt-1 leading-relaxed line-clamp-2"
          style={{ color: theme.textMute }}
        >
          {module.desc}
        </motion.p>
      </div>

      <div
        className="flex items-end justify-between pt-3 border-t"
        style={{ borderColor: theme.border }}
      >
        <span className="text-[10px] tracking-[0.18em] uppercase" style={{ color: theme.textGhost }}>
          {totalEndpoints === 0 ? 'vazio' : `${totalEndpoints} endpoints`}
        </span>
        <span className="signature text-base">— Lucas</span>
      </div>
    </motion.div>
  );
}

// ───────────────────────── Detail (expanded) ─────────────────────────

interface DetailProps {
  module: ModuleSpec;
  onClose: () => void;
}

function EndpointDetail({ module, onClose }: DetailProps) {
  const theme = useTheme();
  const Icon = iconFor(module.icon);
  const [tab, setTab] = useState<'inbound' | 'outbound'>('outbound');

  const list = tab === 'inbound' ? module.inbound : module.outbound;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-zoom-out"
        style={{ background: 'rgba(6, 3, 10, 0.78)', backdropFilter: 'blur(8px)' }}
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-6 pointer-events-none">
        <motion.div
          layoutId={`card-${module.id}`}
          className="sticky-card rounded-3xl w-full max-w-3xl max-h-[85vh] flex flex-col pointer-events-auto overflow-hidden"
          style={{ background: theme.void2 }}
        >
          <div className="flex items-start justify-between p-7 pb-5 border-b" style={{ borderColor: theme.border }}>
            <div className="flex items-start gap-4">
              <CardAvatar
                moduleId={module.id}
                icon={Icon}
                size="lg"
                layoutId={`icon-${module.id}`}
              />
              <div>
                <motion.h2
                  layoutId={`title-${module.id}`}
                  className="text-2xl font-bold tracking-tight"
                  style={{ color: theme.text }}
                >
                  {module.label}
                </motion.h2>
                <motion.p
                  layoutId={`desc-${module.id}`}
                  className="text-sm mt-1"
                  style={{ color: theme.textSoft }}
                >
                  {module.desc}
                </motion.p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:scale-105"
              style={{
                background: 'rgba(196, 67, 67, 0.03)',
                border: `1px solid ${theme.border}`,
                color: theme.textSoft,
              }}
              aria-label="fechar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
            className="flex items-center gap-2 px-7 pt-5"
          >
            <button
              className={`tab-pill flex items-center gap-2 ${tab === 'outbound' ? 'active' : ''}`}
              onClick={() => setTab('outbound')}
            >
              <ArrowUpFromLine className="w-3.5 h-3.5" />
              Saída
              <span className="opacity-60">· {module.outbound.length}</span>
            </button>
            <button
              className={`tab-pill flex items-center gap-2 ${tab === 'inbound' ? 'active' : ''}`}
              onClick={() => setTab('inbound')}
            >
              <ArrowDownToLine className="w-3.5 h-3.5" />
              Entrada
              <span className="opacity-60">· {module.inbound.length}</span>
            </button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.22 }}
            className="flex-1 overflow-y-auto px-7 py-5"
          >
            {list.length === 0 ? (
              <EmptyEndpointState tab={tab} />
            ) : (
              <ul className="space-y-2">
                {list.map((ep) => (
                  <EndpointRow key={ep.id} endpoint={ep} moduleId={module.id} />
                ))}
              </ul>
            )}
          </motion.div>

          <div
            className="flex items-center justify-between px-7 py-4 border-t"
            style={{ borderColor: theme.border, background: 'rgba(196, 67, 67, 0.015)' }}
          >
            <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: theme.textGhost }}>
              card-{module.id}
            </span>
            <span className="signature text-lg">— Lucas</span>
          </div>
        </motion.div>
      </div>
    </>
  );
}

function EmptyEndpointState({ tab }: { tab: 'inbound' | 'outbound' }) {
  const theme = useTheme();
  return (
    <div className="flex flex-col items-center justify-center text-center py-16">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
        style={{ background: 'rgba(107, 87, 100, 0.04)', border: `1px solid ${theme.border}` }}
      >
        {tab === 'outbound' ? (
          <ArrowUpFromLine className="w-5 h-5" style={{ color: theme.textMute }} />
        ) : (
          <ArrowDownToLine className="w-5 h-5" style={{ color: theme.textMute }} />
        )}
      </div>
      <h3 className="text-sm font-semibold mb-1" style={{ color: theme.text }}>
        {tab === 'outbound' ? 'Nenhuma saída mapeada' : 'Nenhuma entrada mapeada'}
      </h3>
      <p className="text-xs max-w-xs" style={{ color: theme.textMute }}>
        {tab === 'outbound'
          ? 'Esse módulo ainda não declarou o que oferece pra dimensão.'
          : 'Esse módulo ainda não declarou o que aceita receber.'}
      </p>
      <button
        className="btn-rift mt-5 flex items-center gap-2"
        disabled
        title="cadastro virá quando o catálogo for editável"
      >
        <Plus className="w-3.5 h-3.5" />
        cadastrar endpoint
      </button>
    </div>
  );
}

function EndpointRow({ endpoint, moduleId }: { endpoint: EndpointSpec; moduleId: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [pathOverride, setPathOverride] = useState(endpoint.path);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<KamuiCallResult | null>(null);

  // re-sync se o spec mudar (catálogo recarregar)
  useEffect(() => { setPathOverride(endpoint.path); }, [endpoint.path]);

  const methodColor =
    endpoint.method === 'GET'    ? '#7ec48f' :
    endpoint.method === 'POST'   ? '#d4a85a' :
    endpoint.method === 'PUT'    ? '#9b87c4' :
    endpoint.method === 'DELETE' ? '#d47878' :
                                   '#5aa5d4';

  const isStream = endpoint.method === 'SSE' || endpoint.method === 'WS';
  const isWrite = !['GET', 'SSE', 'WS'].includes(endpoint.method);
  const hasTemplate = /\{[^}]+\}/.test(endpoint.path);
  const stillHasTemplate = /\{[^}]+\}/.test(pathOverride);
  // Path final pra chamada — o catálogo do TARS já declara paths completos
  // (/api/tars/...), então o tester chama o path diretamente.
  const kamuiUrl = pathOverride.startsWith('/api')
    ? pathOverride
    : `/api/tars${pathOverride}`;

  async function runTest() {
    if (isStream) {
      setResult({
        ok: false,
        tether: moduleId,
        endpoint: pathOverride,
        error: `${endpoint.method} exige cliente streaming; o tester rápido só executa HTTP request/response.`,
        elapsed_ms: 0,
      });
      return;
    }
    if (stillHasTemplate) {
      setResult({
        ok: false,
        tether: moduleId,
        endpoint: pathOverride,
        error: 'substitua os {placeholders} no path antes de testar',
        elapsed_ms: 0,
      });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const started = Date.now();
      const init: RequestInit = { method: endpoint.method };
      if (isWrite) {
        init.headers = { 'Content-Type': 'application/json' };
        // empty body envia '{}' (Maestro rejeita com 400, sem efeito colateral).
        // O examplePayload aparece SO como placeholder — usuário precisa colar/digitar
        // pra de fato disparar uma chamada real.
        init.body = body.trim() || '{}';
      }
      const resp = await fetch(kamuiUrl, init);
      const contentType = resp.headers.get('content-type') ?? '';
      if (contentType.toLowerCase().includes('application/json')) {
        const json = (await resp.json()) as KamuiCallResult;
        setResult(json);
      } else {
        const blob = await resp.blob();
        const elapsed = Number(resp.headers.get('x-kamui-elapsed-ms')) || (Date.now() - started);
        setResult({
          ok: resp.ok,
          tether: moduleId,
          endpoint: pathOverride,
          status: resp.status,
          elapsed_ms: elapsed,
          data: {
            _binary: true,
            content_type: contentType || 'application/octet-stream',
            bytes: blob.size,
          },
        });
      }
    } catch (e) {
      setResult({
        ok: false,
        tether: moduleId,
        endpoint: pathOverride,
        error: (e as Error).message,
        elapsed_ms: 0,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <li className="rounded-lg overflow-hidden transition-all" style={{ border: `1px solid ${theme.border}` }}>
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[rgba(196,67,67,0.03)]"
        onClick={() => setOpen(!open)}
      >
        <span
          className="text-[10px] font-bold tracking-wider px-2 py-1 rounded"
          style={{ background: 'rgba(0,0,0,0.3)', color: methodColor, minWidth: 48, textAlign: 'center' }}
        >
          {endpoint.method}
        </span>
        <code className="text-xs font-mono flex-1" style={{ color: theme.text }}>
          {endpoint.path}
        </code>
        <span className="text-[11px] hidden md:inline" style={{ color: theme.textMute }}>
          {endpoint.summary}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          className="ml-2 w-7 h-7 rounded flex items-center justify-center transition-all hover:scale-105"
          style={{
            background: 'rgba(196, 67, 67, 0.05)',
            color: theme.sharingan,
            border: `1px solid ${theme.border}`,
          }}
          title={open ? 'fechar tester' : 'abrir tester'}
        >
          <ChevronDown
            className="w-3.5 h-3.5 transition-transform"
            style={{ transform: open ? 'rotate(180deg)' : undefined }}
          />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
            style={{ background: 'rgba(0, 0, 0, 0.2)', borderTop: `1px solid ${theme.border}` }}
          >
            <div className="p-3 space-y-3">
              {hasTemplate && (
                <div>
                  <label className="text-[10px] tracking-[0.18em] uppercase mb-1.5 block" style={{ color: theme.textMute }}>
                    path (substitua os {'{...}'} antes de testar)
                  </label>
                  <input
                    type="text"
                    value={pathOverride}
                    onChange={(e) => setPathOverride(e.target.value)}
                    spellCheck={false}
                    className="w-full font-mono text-[11px] px-3 py-2 rounded outline-none"
                    style={{
                      background: 'rgba(0,0,0,0.4)',
                      border: `1px solid ${stillHasTemplate ? 'rgba(212, 168, 90, 0.35)' : theme.border}`,
                      color: theme.text,
                    }}
                  />
                </div>
              )}

              {isWrite && (
                <div>
                  <label className="text-[10px] tracking-[0.18em] uppercase mb-1.5 block" style={{ color: theme.textMute }}>
                    body (json)
                  </label>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={endpoint.examplePayload ?? '{}'}
                    spellCheck={false}
                    className="w-full font-mono text-[11px] px-3 py-2 rounded outline-none resize-y"
                    style={{
                      background: 'rgba(0,0,0,0.4)',
                      border: `1px solid ${theme.border}`,
                      color: theme.text,
                      minHeight: 72,
                    }}
                  />
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] truncate" style={{ color: theme.textGhost }}>
                  via <code className="font-mono">{kamuiUrl}</code>
                </div>
                <button
                  onClick={runTest}
                  disabled={loading || stillHasTemplate || isStream}
                  className="btn-rift flex items-center gap-2 text-xs shrink-0"
                  title={
                    isStream ? `${endpoint.method} não é testável pelo runner rápido` :
                    stillHasTemplate ? 'substitua os {placeholders} primeiro' :
                    undefined
                  }
                >
                  {loading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  {isStream ? 'stream' : loading ? 'chamando...' : 'testar'}
                </button>
              </div>

              {result && <ResultPanel result={result} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function ResultPanel({ result }: { result: KamuiCallResult }) {
  const theme = useTheme();
  const statusColor =
    result.error           ? '#d47878' :
    !result.status         ? theme.textMute :
    result.status >= 500   ? '#d47878' :
    result.status >= 400   ? '#d4a85a' :
    result.status >= 200   ? '#7ec48f' :
                             theme.textMute;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="rounded-lg overflow-hidden"
      style={{
        background: 'rgba(0, 0, 0, 0.35)',
        border: `1px solid ${result.ok ? 'rgba(126, 196, 143, 0.20)' : 'rgba(212, 120, 120, 0.20)'}`,
      }}
    >
      <div className="flex items-center gap-3 px-3 py-2 border-b" style={{ borderColor: theme.border }}>
        {result.ok ? (
          <Check className="w-4 h-4" style={{ color: '#7ec48f' }} />
        ) : (
          <AlertTriangle className="w-4 h-4" style={{ color: '#d47878' }} />
        )}
        {result.status !== undefined && (
          <span
            className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded"
            style={{ background: 'rgba(0,0,0,0.3)', color: statusColor }}
          >
            {result.status}
          </span>
        )}
        <span className="text-[11px] flex-1" style={{ color: theme.textSoft }}>
          {result.ok ? 'sucesso' : (result.error ?? 'falha no tether')}
        </span>
        <span className="text-[10px] font-mono" style={{ color: theme.textMute }}>
          {result.elapsed_ms}ms
        </span>
      </div>
      {result.data !== undefined && result.data !== null && (
        <pre
          className="text-[10.5px] font-mono p-3 overflow-auto leading-relaxed"
          style={{ color: theme.textSoft, maxHeight: 280, margin: 0 }}
        >
          {typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)}
        </pre>
      )}
    </motion.div>
  );
}

// ───────────────────────── Página ─────────────────────────

export default function EndpointsPage() {
  const theme = useTheme();
  const [catalog, setCatalog] = useState<ModuleSpec[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Catálogo vem do backend. Mesma fonte que o CLI consulta.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/tars/endpoints')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<CatalogResponse>;
      })
      .then(d => {
        if (cancelled) return;
        if (!Array.isArray(d.modules)) throw new Error('catálogo sem modules[]');
        setCatalog(d.modules);
      })
      .catch(e => { if (!cancelled) setLoadError((e as Error).message); });
    return () => { cancelled = true; };
  }, []);

  if (loadError) {
    return (
      <div className="space-y-4">
        <h1 className="void-title text-4xl">Endpoints</h1>
        <div className="void-panel rounded-2xl p-8">
          <h2 className="text-lg font-semibold mb-2" style={{ color: theme.text }}>
            Backend do TARS offline
          </h2>
          <p className="text-sm" style={{ color: theme.textSoft }}>
            Não consegui carregar o catálogo de <code>/api/tars/endpoints</code>.
            Suba o backend na porta 62026 e recarrega a página.
          </p>
          <p className="text-[10px] mt-3 font-mono" style={{ color: theme.textGhost }}>
            erro: {loadError}
          </p>
        </div>
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className="space-y-4">
        <h1 className="void-title text-4xl">Endpoints</h1>
        <div className="flex items-center gap-3 text-sm" style={{ color: theme.textMute }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          carregando catálogo da dimensão...
        </div>
      </div>
    );
  }

  const featured = catalog.find(m => m.featured);
  const rest = catalog.filter(m => !m.featured);
  const selected = catalog.find(m => m.id === selectedId);

  return (
    <div className="space-y-8 pb-10">
      <motion.div variants={fadeUp} initial="hidden" animate="show">
        <h1 className="void-title text-4xl">Endpoints</h1>
        <p className="text-sm mt-2" style={{ color: theme.textSoft }}>
          O que cada módulo pode <span style={{ color: theme.sharingan }}>oferecer</span> e
          o que pode <span style={{ color: theme.sharingan }}>receber</span> pela dimensão.
        </p>
      </motion.div>

      <LayoutGroup>
        {featured && (
          <motion.div variants={fadeUp} initial="hidden" animate="show">
            <StickyCard module={featured} onClick={() => setSelectedId(featured.id)} />
          </motion.div>
        )}

        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4"
        >
          {rest.map((m) => (
            <motion.div key={m.id} variants={fadeUp}>
              <StickyCard module={m} onClick={() => setSelectedId(m.id)} />
            </motion.div>
          ))}
        </motion.div>

        <AnimatePresence mode="wait">
          {selected && (
            <EndpointDetail
              key={selected.id}
              module={selected}
              onClose={() => setSelectedId(null)}
            />
          )}
        </AnimatePresence>
      </LayoutGroup>
    </div>
  );
}
