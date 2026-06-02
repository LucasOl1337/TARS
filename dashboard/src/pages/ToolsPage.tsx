import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Bot,
  BrainCircuit,
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
  ShieldCheck,
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

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.id === selectedId) || tools[0],
    [selectedId, tools],
  );

  const groupedTools = useMemo(() => {
    return tools.reduce<Record<string, ToolSpec[]>>((acc, tool) => {
      const key = tool.category || 'geral';
      acc[key] ||= [];
      acc[key].push(tool);
      return acc;
    }, {});
  }, [tools]);

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
    <div className="space-y-8">
      <motion.div variants={fadeUp} initial="hidden" animate="show" className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: theme.sharinganSoft, border: `1px solid ${theme.borderHover}` }}
            >
              <Wrench className="w-5 h-5" style={{ color: theme.sharingan }} />
            </div>
            <div>
              <h1 className="void-title text-4xl">Ferramentas</h1>
              <p className="mt-1 text-sm" style={{ color: theme.textSoft }}>
                Arsenal operacional do TARS: catálogo, contrato, executor e chat.
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={loadTools}
          className="btn-rift inline-flex items-center justify-center gap-2"
          title="Recarregar catálogo"
        >
          <RefreshCw className="w-4 h-4" />
          Recarregar
        </button>
      </motion.div>

      {error && (
        <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      <motion.div variants={fadeUp} initial="hidden" animate="show" className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {[
          { icon: Wrench, label: 'catalogadas', value: String(tools.length) },
          { icon: CheckCircle2, label: 'executáveis', value: String(executableCount) },
          { icon: BrainCircuit, label: 'provider', value: providers?.active?.provider || 'offline' },
          { icon: Bot, label: 'modelo', value: providers?.active?.model || 'não configurado' },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="void-panel rounded-xl p-4">
              <div className="flex items-center justify-between gap-3">
                <Icon className="h-4 w-4" style={{ color: theme.sharingan }} />
                <span className="text-[10px] uppercase tracking-[0.22em]" style={{ color: theme.textGhost }}>
                  {item.label}
                </span>
              </div>
              <div className="mt-3 truncate text-lg font-semibold" style={{ color: theme.text }}>
                {item.value}
              </div>
            </div>
          );
        })}
      </motion.div>

      {catalogErrors && catalogErrors.length > 0 && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
          {catalogErrors.map((item) => `${item.file || 'arquivo'}: ${item.error || 'erro'}`).join(' · ')}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
        <div className="space-y-5">
          <motion.div variants={fadeUp} initial="hidden" animate="show" className="void-panel rounded-2xl p-5">
            <SectionLabel icon={Route} label="catálogo" />
            <div className="mt-4 space-y-4">
              {Object.entries(groupedTools).map(([category, items]) => (
                <div key={category}>
                  <div className="mb-2 text-[10px] uppercase tracking-[0.22em]" style={{ color: theme.textGhost }}>
                    {category}
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {items.map((tool) => {
                      const active = selectedTool?.id === tool.id;
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          onClick={() => setSelectedId(tool.id)}
                          className={`rounded-xl border p-4 text-left transition-all ${
                            active ? 'bg-white/[0.055]' : 'bg-white/[0.015] hover:bg-white/[0.035]'
                          }`}
                          style={{ borderColor: active ? theme.borderActive : theme.border }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold" style={{ color: theme.text }}>
                                {tool.name}
                              </div>
                              <div className="mt-1 text-[11px] font-mono" style={{ color: theme.textGhost }}>
                                {tool.id}
                              </div>
                            </div>
                            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${statusTone(tool.executable)}`}>
                              {tool.executable ? 'exec' : 'doc'}
                            </span>
                          </div>
                          <p className="mt-3 line-clamp-2 text-xs leading-relaxed" style={{ color: theme.textSoft }}>
                            {tool.description}
                          </p>
                          {tool.capabilities.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {tool.capabilities.slice(0, 3).map((capability) => (
                                <span key={capability} className="rounded-md border border-white/10 bg-white/[0.025] px-2 py-1 text-[10px]" style={{ color: theme.textMute }}>
                                  {capability}
                                </span>
                              ))}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {selectedTool && (
            <motion.div variants={fadeUp} initial="hidden" animate="show" className="void-panel rounded-2xl p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <SectionLabel icon={FileText} label="documentação inteligente" />
                  <h2 className="mt-3 text-xl font-semibold" style={{ color: theme.text }}>
                    {selectedTool.name}
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm leading-relaxed" style={{ color: theme.textSoft }}>
                    {selectedTool.prompt_instruction || selectedTool.description}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={copyDoc}
                  className="btn-rift inline-flex items-center justify-center gap-2"
                  title="Copiar doc da ferramenta"
                >
                  <Copy className="h-4 w-4" />
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: theme.textSoft }}>
                    <Terminal className="h-4 w-4" />
                    POST {endpointFor(selectedTool)}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-white/[0.025] p-3">
                      <div className="text-white/35">invoke</div>
                      <div className="mt-1 font-mono" style={{ color: theme.text }}>
                        {selectedTool.invoke?.type || 'catalog'}
                      </div>
                    </div>
                    <div className="rounded-lg bg-white/[0.025] p-3">
                      <div className="text-white/35">executor</div>
                      <div className="mt-1 truncate font-mono" style={{ color: theme.text }}>
                        {selectedTool.invoke?.handler || selectedTool.invoke?.bridge || 'sem executor'}
                      </div>
                    </div>
                  </div>
                  <pre className="mt-4 max-h-64 overflow-auto rounded-lg border border-white/10 bg-black/30 p-3 text-[11px] leading-relaxed" style={{ color: theme.textSoft }}>
                    {toolDoc(selectedTool)}
                  </pre>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: theme.textSoft }}>
                    <Code2 className="h-4 w-4" />
                    JSON Schema
                  </div>
                  <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-white/10 bg-black/30 p-3 text-[11px] leading-relaxed" style={{ color: theme.textSoft }}>
                    {pretty(selectedTool.parameters || {})}
                  </pre>
                </div>
              </div>
            </motion.div>
          )}

          {selectedTool && (
            <motion.div variants={fadeUp} initial="hidden" animate="show" className="void-panel rounded-2xl p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <SectionLabel icon={Play} label="executor manual" />
                <button
                  type="button"
                  onClick={invokeSelectedTool}
                  disabled={!selectedTool.executable || invoking}
                  className="btn-rift inline-flex items-center justify-center gap-2"
                  title="Executar ferramenta"
                >
                  {invoking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Executar
                </button>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <textarea
                  value={invokeInput}
                  onChange={(event) => setInvokeInput(event.target.value)}
                  spellCheck={false}
                  className="min-h-[260px] resize-y rounded-xl border border-white/10 bg-black/25 p-4 font-mono text-xs leading-relaxed outline-none transition focus:border-white/25"
                  style={{ color: theme.textSoft }}
                />
                <div className="min-h-[260px] rounded-xl border border-white/10 bg-black/25 p-4">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold" style={{ color: theme.textSoft }}>
                    {invokeError ? <XCircle className="h-4 w-4 text-red-300" /> : <CheckCircle2 className="h-4 w-4 text-emerald-300" />}
                    resultado
                  </div>
                  {invokeError ? (
                    <pre className="overflow-auto whitespace-pre-wrap text-xs text-red-200">{invokeError}</pre>
                  ) : invokeResult ? (
                    <pre className="max-h-[230px] overflow-auto text-xs leading-relaxed" style={{ color: theme.textSoft }}>
                      {pretty(invokeResult)}
                    </pre>
                  ) : (
                    <div className="flex h-[210px] items-center justify-center text-center text-xs" style={{ color: theme.textGhost }}>
                      {selectedTool.executable ? 'aguardando execução' : 'ferramenta apenas documentada'}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </div>

        <div className="space-y-5 xl:sticky xl:top-4 xl:self-start">
          <motion.div variants={fadeUp} initial="hidden" animate="show" className="void-panel rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3">
              <SectionLabel icon={MessageSquare} label="chat de teste" />
              <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${statusTone(providers?.ready)}`}>
                {providers?.ready ? 'llm pronto' : 'llm offline'}
              </span>
            </div>

            <div className="mt-4 flex h-[480px] flex-col rounded-xl border border-white/10 bg-black/20">
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {chatMessages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[88%] rounded-2xl border px-4 py-3 ${
                        message.role === 'user'
                          ? 'border-white/15 bg-white/[0.08]'
                          : 'border-white/10 bg-white/[0.025]'
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em]" style={{ color: theme.textGhost }}>
                        {message.role === 'user' ? <Sparkles className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                        {message.role === 'user' ? 'humano' : 'tars'}
                        {message.meta && <span className="normal-case tracking-normal text-white/30">{message.meta}</span>}
                      </div>
                      <div className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: theme.textSoft }}>
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

              <div className="border-t border-white/10 p-3">
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
                    className="min-h-[76px] flex-1 resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm outline-none transition focus:border-white/25"
                    style={{ color: theme.text }}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={sendChat}
                    disabled={chatLoading || !chatInput.trim()}
                    className="btn-rift flex w-12 items-center justify-center px-0"
                    title="Enviar"
                  >
                    {chatLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
                {chatError && <div className="mt-2 text-xs text-red-300">{chatError}</div>}
              </div>
            </div>
          </motion.div>

          <motion.div variants={fadeUp} initial="hidden" animate="show" className="void-panel rounded-2xl p-5">
            <SectionLabel icon={ShieldCheck} label="plano de ativação" />
            <div className="mt-4 space-y-3">
              {[
                ['1', 'Registrar tools como catálogo JSON com schema, prompt_instruction e executor.'],
                ['2', 'Copiar endpoints do 9router/Videogen como invoke bridge ou adapter dedicado.'],
                ['3', 'Adicionar loop de decisão no chat: modelo escolhe tool, backend executa, modelo finaliza.'],
                ['4', 'Persistir auditoria em echoes: input, ferramenta, latência, custo e artefatos gerados.'],
              ].map(([step, text]) => (
                <div key={step} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.018] p-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-xs font-semibold" style={{ color: theme.text }}>
                    {step}
                  </div>
                  <div className="text-sm leading-relaxed" style={{ color: theme.textSoft }}>
                    {text}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
