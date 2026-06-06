import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Bot,
  CheckCircle2,
  Code2,
  Copy,
  FileText,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  Route,
  Send,
  Sparkles,
  Terminal,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

interface JsonObject {
  [key: string]: JsonValue | undefined;
}

interface ToolInvoke {
  type?: string;
  handler?: string;
  bridge?: string;
  method?: string;
  endpoint?: string;
}

interface ToolSchema extends JsonObject {
  type?: string;
  properties?: Record<string, JsonObject>;
  required?: string[];
}

interface ToolSpec {
  id: string;
  name: string;
  description: string;
  category: string;
  kind: string;
  provider: string;
  capabilities: string[];
  tags: string[];
  prompt_instruction: string;
  parameters: ToolSchema;
  invoke: ToolInvoke;
  executable?: boolean;
}

interface ToolsResponse {
  tools?: ToolSpec[];
  errors?: Array<{ file?: string; error?: string }>;
  count?: number;
}

interface ProviderState {
  ready?: boolean;
  available?: string[];
  active?: {
    provider?: string | null;
    model?: string | null;
  };
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  meta?: string;
}

type SidePanel = 'contract' | 'executor' | 'chat';

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] as const } },
};

const initialChat: ChatMessage[] = [
  {
    role: 'assistant',
    content: 'TARS online. Ferramentas carregadas no arsenal quando o backend expõe o catálogo.',
    meta: 'sistema',
  },
];

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

async function readJsonResponse(res: Response) {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`HTTP ${res.status}: resposta vazia do backend`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: resposta não-JSON do backend: ${text.slice(0, 240)}`);
  }
}

function sampleForProperty(name: string, schema: JsonObject): JsonValue {
  const enumValues = Array.isArray(schema.enum) ? schema.enum : [];
  if (enumValues.length > 0) return enumValues[0] as JsonValue;

  const type = String(schema.type || 'string');
  if (type === 'number' || type === 'integer') {
    if (name.toLowerCase().includes('r1')) return 7000;
    if (name.toLowerCase().includes('r2')) return 12000;
    if (name.toLowerCase().includes('r_')) return 7000;
    return 1;
  }
  if (type === 'boolean') return true;
  if (type === 'array') return [];
  if (type === 'object') return {};

  const key = name.toLowerCase();
  if (key.includes('body')) return 'mars';
  if (key.includes('prompt')) return 'Base de pesquisa em Marte, arquitetura modular branca, astronautas ao fundo, luz cinematográfica, alta definição.';
  if (key.includes('model')) return 'cx/gpt-5.5-image';
  if (key.includes('entry')) return 'Registrar teste de ferramenta no TARS.';
  if (key.includes('category')) return 'teste';
  if (key.includes('thought')) return 'Planejar a chamada de ferramenta antes de responder.';
  if (key.includes('bridge')) return 'yume';
  return `valor_${name}`;
}

function buildSampleInput(tool?: ToolSpec) {
  if (!tool) return '{}';
  const properties = tool.parameters?.properties || {};
  const payload: Record<string, JsonValue> = {};
  Object.entries(properties).forEach(([name, schema]) => {
    payload[name] = sampleForProperty(name, schema);
  });
  return pretty(payload);
}

function endpointFor(tool?: ToolSpec) {
  if (!tool) return '/api/tars/tools/{tool_id}/invoke';
  return `/api/tars/tools/${tool.id}/invoke`;
}

function toolDoc(tool?: ToolSpec) {
  if (!tool) return '';
  return [
    `tool_id: ${tool.id}`,
    `nome: ${tool.name}`,
    `provider: ${tool.provider}`,
    `quando usar: ${tool.prompt_instruction || tool.description}`,
    `endpoint: POST ${endpointFor(tool)}`,
    `payload: { "input": ${buildSampleInput(tool).replace(/\n/g, '\n  ')} }`,
  ].join('\n');
}

function statusTone(ok?: boolean) {
  if (ok === true) return 'text-emerald-300 border-emerald-400/20 bg-emerald-400/10';
  if (ok === false) return 'text-red-300 border-red-400/20 bg-red-400/10';
  return 'text-white/50 border-white/10 bg-white/[0.03]';
}

function SectionLabel({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.22em] uppercase text-white/40">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </div>
  );
}

export default function ToolsPage() {
  const theme = useTheme();
  const [tools, setTools] = useState<ToolSpec[]>([]);
  const [catalogErrors, setCatalogErrors] = useState<ToolsResponse['errors']>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invokeInput, setInvokeInput] = useState('{}');
  const [invokeResult, setInvokeResult] = useState<unknown>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [invoking, setInvoking] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(initialChat);
  const [chatInput, setChatInput] = useState('TARS, gere uma imagem conceitual de uma base em Marte usando a ferramenta certa.');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activePanel, setActivePanel] = useState<SidePanel>('contract');

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.id === selectedId) || tools[0],
    [selectedId, tools],
  );

  const compactTools = useMemo(() => {
    return [...tools].sort((a, b) => {
      const category = (a.category || 'geral').localeCompare(b.category || 'geral');
      if (category !== 0) return category;
      return a.name.localeCompare(b.name);
    });
  }, [tools]);

  const categoryCount = useMemo(() => new Set(tools.map((tool) => tool.category || 'geral')).size, [tools]);
  const executableCount = tools.filter((tool) => tool.executable).length;

  async function loadTools() {
    setLoading(true);
    setError(null);
    try {
      const [toolsRes, providersRes] = await Promise.all([
        fetch('/api/tars/tools'),
        fetch('/api/tars/chat/providers'),
      ]);
      if (!toolsRes.ok) throw new Error(await toolsRes.text());
      const data = (await toolsRes.json()) as ToolsResponse;
      const rows = Array.isArray(data.tools) ? data.tools : [];
      setTools(rows);
      setCatalogErrors(data.errors || []);
      setSelectedId((current) => current || rows[0]?.id || null);

      if (providersRes.ok) {
        setProviders((await providersRes.json()) as ProviderState);
      } else {
        setProviders(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTools();
  }, []);

  useEffect(() => {
    setInvokeInput(buildSampleInput(selectedTool));
    setInvokeResult(null);
    setInvokeError(null);
  }, [selectedTool?.id]);

  async function invokeSelectedTool() {
    if (!selectedTool) return;
    setInvoking(true);
    setInvokeError(null);
    setInvokeResult(null);
    try {
      const parsed = JSON.parse(invokeInput || '{}') as JsonObject;
      const res = await fetch(endpointFor(selectedTool), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: parsed }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(pretty(data));
      setInvokeResult(data);
    } catch (err) {
      setInvokeError(err instanceof Error ? err.message : String(err));
    } finally {
      setInvoking(false);
    }
  }

  async function sendChat() {
    const content = chatInput.trim();
    if (!content || chatLoading) return;
    const nextMessages: ChatMessage[] = [...chatMessages, { role: 'user', content }];
    setChatMessages(nextMessages);
    setChatInput('');
    setChatError(null);
    setChatLoading(true);
    try {
      const res = await fetch('/api/tars/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content: messageContent }) => ({ role, content: messageContent })),
          max_tokens: 900,
        }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) throw new Error(data.error || pretty(data));
      const calls = Array.isArray(data.tool_calls) ? data.tool_calls : [];
      const toolMeta = calls.length > 0
        ? ` · tool: ${calls.map((call: { tool_id?: string; ok?: boolean }) => `${call.tool_id || 'tool'} ${call.ok ? 'ok' : 'erro'}`).join(', ')}`
        : '';
      setChatMessages([
        ...nextMessages,
        {
          role: 'assistant',
          content: String(data.reply || ''),
          meta: `${data.provider || 'provider'} / ${data.model || 'modelo'} · ${data.elapsed_ms || 0}ms${toolMeta}`,
        },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setChatError(message);
      setChatMessages([
        ...nextMessages,
        { role: 'assistant', content: `Falha no chat: ${message}`, meta: 'erro' },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  async function copyDoc() {
    if (!selectedTool) return;
    await navigator.clipboard.writeText(toolDoc(selectedTool));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="flex items-center gap-3 text-sm tracking-[0.22em] uppercase" style={{ color: theme.textMute }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          carregando arsenal
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <motion.div variants={fadeUp} initial="hidden" animate="show" className="mission-shell flex flex-col gap-3 rounded-lg p-3 sm:p-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <div className="panel-kicker">
              <Wrench className="h-3.5 w-3.5" />
              tool arsenal
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: theme.text }}>Ferramentas</h1>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${statusTone(providers?.ready)}`}>
              {providers?.ready ? 'llm pronto' : 'llm offline'}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: theme.textSoft }}>
            Catálogo compacto, contrato, executor manual e chat de teste no mesmo painel.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[
            ['catalogadas', tools.length],
            ['executáveis', executableCount],
            ['categorias', categoryCount],
            ['provider', providers?.active?.provider || 'offline'],
            ['modelo', providers?.active?.model || 'sem modelo'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <div className="text-[9px] uppercase tracking-[0.18em]" style={{ color: theme.textGhost }}>
                {label}
              </div>
              <div className="mt-0.5 max-w-[150px] truncate text-xs font-semibold" style={{ color: theme.text }}>
                {value}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={loadTools}
            className="btn-rift inline-flex items-center justify-center gap-2 px-3 py-2 text-xs"
            title="Recarregar catálogo"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Recarregar
          </button>
        </div>
      </motion.div>

      {error && (
        <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {catalogErrors && catalogErrors.length > 0 && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">
          {catalogErrors.map((item) => `${item.file || 'arquivo'}: ${item.error || 'erro'}`).join(' · ')}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.42fr)] 2xl:grid-cols-[minmax(0,1fr)_520px]">
        <motion.div variants={fadeUp} initial="hidden" animate="show" className="void-panel rounded-xl p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionLabel icon={Route} label="catálogo compacto" />
            <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: theme.textGhost }}>
              {tools.length} tools · {categoryCount} categorias
            </div>
          </div>

          <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-2">
            {compactTools.map((tool) => {
              const active = selectedTool?.id === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => setSelectedId(tool.id)}
                  className={`group min-h-[62px] rounded-lg border px-3 py-2 text-left transition-all ${
                    active ? 'bg-white/[0.06]' : 'bg-white/[0.014] hover:bg-white/[0.035]'
                  }`}
                  style={{ borderColor: active ? theme.borderActive : theme.border }}
                  title={`${tool.name}\n${tool.id}\n${tool.description}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold leading-tight" style={{ color: theme.text }}>
                        {tool.name}
                      </div>
                      <div className="mt-1 truncate font-mono text-[10px]" style={{ color: theme.textGhost }}>
                        {tool.id}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] ${statusTone(tool.executable)}`}>
                      {tool.executable ? 'exec' : 'doc'}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em]" style={{ color: theme.textMute }}>
                      {tool.category || 'geral'}
                    </span>
                    {tool.capabilities.length > 0 && (
                      <span className="truncate text-[10px]" style={{ color: theme.textGhost }}>
                        {tool.capabilities.slice(0, 2).join(' · ')}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </motion.div>

        <div className="space-y-3 xl:sticky xl:top-3 xl:self-start">
          {selectedTool && (
            <motion.div variants={fadeUp} initial="hidden" animate="show" className="void-panel rounded-xl p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SectionLabel icon={FileText} label="selecionada" />
                  <h2 className="mt-2 truncate text-lg font-semibold" style={{ color: theme.text }}>
                    {selectedTool.name}
                  </h2>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed" style={{ color: theme.textSoft }}>
                    {selectedTool.prompt_instruction || selectedTool.description}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${statusTone(selectedTool.executable)}`}>
                  {selectedTool.executable ? 'exec' : 'doc'}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                {[
                  ['categoria', selectedTool.category || 'geral'],
                  ['provider', selectedTool.provider || 'local'],
                  ['invoke', selectedTool.invoke?.type || 'catalog'],
                  ['executor', selectedTool.invoke?.handler || selectedTool.invoke?.bridge || 'sem executor'],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-[0.15em]" style={{ color: theme.textGhost }}>
                      {label}
                    </div>
                    <div className="mt-0.5 truncate font-mono" style={{ color: theme.textSoft }}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
                {[
                  { id: 'contract' as const, label: 'Contrato', icon: Terminal },
                  { id: 'executor' as const, label: 'Executor', icon: Play },
                  { id: 'chat' as const, label: 'Chat', icon: MessageSquare },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const active = activePanel === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActivePanel(tab.id)}
                      className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition ${
                        active ? 'bg-white/[0.08]' : 'text-white/45 hover:bg-white/[0.04] hover:text-white/70'
                      }`}
                      style={{ color: active ? theme.text : undefined }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {activePanel === 'contract' && (
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold" style={{ color: theme.textSoft }}>
                    <span className="truncate">POST {endpointFor(selectedTool)}</span>
                    <button
                      type="button"
                      onClick={copyDoc}
                      className="btn-rift inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs"
                      title="Copiar doc da ferramenta"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copied ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                  <pre className="mt-2 h-[236px] overflow-auto rounded-lg border border-white/10 bg-black/30 p-3 text-[10.5px] leading-relaxed" style={{ color: theme.textSoft }}>
                    {toolDoc(selectedTool)}
                  </pre>
                  <div className="mt-2 flex items-center gap-2 text-xs font-semibold" style={{ color: theme.textSoft }}>
                    <Code2 className="h-3.5 w-3.5" />
                    JSON Schema
                  </div>
                  <pre className="mt-2 h-[176px] overflow-auto rounded-lg border border-white/10 bg-black/30 p-3 text-[10.5px] leading-relaxed" style={{ color: theme.textSoft }}>
                    {pretty(selectedTool.parameters || {})}
                  </pre>
                </div>
              )}

              {activePanel === 'executor' && (
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-2">
                    <SectionLabel icon={Play} label="executor manual" />
                    <button
                      type="button"
                      onClick={invokeSelectedTool}
                      disabled={!selectedTool.executable || invoking}
                      className="btn-rift inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs"
                      title="Executar ferramenta"
                    >
                      {invoking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                      Executar
                    </button>
                  </div>
                  <textarea
                    value={invokeInput}
                    onChange={(event) => setInvokeInput(event.target.value)}
                    spellCheck={false}
                    className="mt-2 h-[210px] w-full resize-none rounded-lg border border-white/10 bg-black/25 p-3 font-mono text-[11px] leading-relaxed outline-none transition focus:border-white/25"
                    style={{ color: theme.textSoft }}
                  />
                  <div className="mt-2 h-[228px] rounded-lg border border-white/10 bg-black/25 p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold" style={{ color: theme.textSoft }}>
                      {invokeError ? <XCircle className="h-3.5 w-3.5 text-red-300" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />}
                      resultado
                    </div>
                    {invokeError ? (
                      <pre className="h-[184px] overflow-auto whitespace-pre-wrap text-xs text-red-200">{invokeError}</pre>
                    ) : invokeResult ? (
                      <pre className="h-[184px] overflow-auto text-xs leading-relaxed" style={{ color: theme.textSoft }}>
                        {pretty(invokeResult)}
                      </pre>
                    ) : (
                      <div className="flex h-[184px] items-center justify-center text-center text-xs" style={{ color: theme.textGhost }}>
                        {selectedTool.executable ? 'aguardando execução' : 'ferramenta apenas documentada'}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activePanel === 'chat' && (
                <div className="mt-3 flex h-[456px] flex-col rounded-lg border border-white/10 bg-black/20">
                  <div className="flex-1 space-y-2 overflow-y-auto p-3">
                    {chatMessages.map((message, index) => (
                      <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[92%] rounded-xl border px-3 py-2 ${
                            message.role === 'user'
                              ? 'border-white/15 bg-white/[0.08]'
                              : 'border-white/10 bg-white/[0.025]'
                          }`}
                        >
                          <div className="mb-1 flex items-center gap-2 text-[9px] uppercase tracking-[0.16em]" style={{ color: theme.textGhost }}>
                            {message.role === 'user' ? <Sparkles className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                            {message.role === 'user' ? 'humano' : 'tars'}
                            {message.meta && <span className="normal-case tracking-normal text-white/30">{message.meta}</span>}
                          </div>
                          <div className="whitespace-pre-wrap text-xs leading-relaxed" style={{ color: theme.textSoft }}>
                            {message.content}
                          </div>
                        </div>
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="flex items-center gap-2 text-xs" style={{ color: theme.textGhost }}>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        processando
                      </div>
                    )}
                  </div>

                  <div className="border-t border-white/10 p-2">
                    <div className="flex gap-2">
                      <textarea
                        value={chatInput}
                        onChange={(event) => setChatInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            sendChat();
                          }
                        }}
                        className="h-[58px] flex-1 resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-white/25"
                        style={{ color: theme.text }}
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        onClick={sendChat}
                        disabled={chatLoading || !chatInput.trim()}
                        className="btn-rift flex w-10 items-center justify-center px-0"
                        title="Enviar"
                      >
                        {chatLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </button>
                    </div>
                    {chatError && <div className="mt-2 text-xs text-red-300">{chatError}</div>}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
