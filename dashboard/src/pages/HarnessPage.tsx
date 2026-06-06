import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  BrainCircuit,
  Check,
  CirclePlus,
  ClipboardCheck,
  Clock3,
  FlaskConical,
  GitBranch,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  Route,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useTheme } from '@/hooks/useTheme';

interface EngineModel {
  id: string;
  provider: string;
  label: string;
  model: string;
  available: boolean;
}

interface EnginesResponse {
  active?: {
    model?: string;
    provider?: string | null;
  };
  models?: EngineModel[];
}

interface ToolSpec {
  id: string;
  name: string;
  category?: string;
  executable?: boolean;
}

interface ToolsResponse {
  tools?: ToolSpec[];
}

interface PersonaSpec {
  slug: string;
  name: string;
  role?: string;
  tone?: string;
}

interface PersonasResponse {
  personas?: PersonaSpec[];
}

type StageKind = 'llm' | 'tool' | 'review' | 'transform' | 'branch';
type ErrorPolicy = 'auto_repair' | 'best_effort' | 'continue' | 'stop';

interface HarnessStage {
  id: string;
  title: string;
  kind: StageKind;
  model: string;
  persona: string;
  tool: string;
  instruction: string;
  errorPolicy?: ErrorPolicy;
}

interface HarnessRunStageResult {
  index: number;
  id?: string;
  title: string;
  kind?: StageKind | string;
  ok: boolean;
  model?: string;
  persona?: string;
  tool?: string | null;
  provider?: string;
  elapsed_ms?: number;
  output?: string;
  error?: string;
  warning?: string;
  recovered?: boolean;
  partial?: boolean;
  error_policy?: ErrorPolicy | string;
}

interface HarnessRunResponse {
  ok: boolean;
  trace_id?: string;
  elapsed_ms?: number;
  count?: number;
  completed?: number;
  results?: HarnessRunStageResult[];
  final_output?: string;
  error?: string;
}

type RunStageStatus = 'queued' | 'running' | 'ok' | 'error';

interface HarnessRunVisualStage extends HarnessStage {
  index: number;
  status: RunStageStatus;
  result?: HarnessRunStageResult;
}

const stageTemplates: Array<{
  kind: StageKind;
  label: string;
  description: string;
  icon: React.ElementType;
  defaultTitle: string;
  defaultInstruction: string;
}> = [
  {
    kind: 'llm',
    label: 'Chamada LLM',
    description: 'Processa texto com modelo e persona escolhidos.',
    icon: BrainCircuit,
    defaultTitle: 'Processar com LLM',
    defaultInstruction: 'Descreva a tarefa que este modelo deve executar.',
  },
  {
    kind: 'tool',
    label: 'Ferramenta',
    description: 'Chama uma ferramenta do TARS com contexto da etapa.',
    icon: Wrench,
    defaultTitle: 'Executar ferramenta',
    defaultInstruction: 'Defina o que a ferramenta deve receber ou produzir.',
  },
  {
    kind: 'review',
    label: 'Validação',
    description: 'Confere saída, qualidade ou critérios antes de seguir.',
    icon: ClipboardCheck,
    defaultTitle: 'Validar resultado',
    defaultInstruction: 'Liste os critérios de aceite desta etapa.',
  },
  {
    kind: 'transform',
    label: 'Transformação',
    description: 'Reformata, resume, extrai ou normaliza dados.',
    icon: Route,
    defaultTitle: 'Transformar dados',
    defaultInstruction: 'Explique a transformação esperada.',
  },
  {
    kind: 'branch',
    label: 'Decisão',
    description: 'Escolhe o próximo caminho do fluxo.',
    icon: GitBranch,
    defaultTitle: 'Decidir caminho',
    defaultInstruction: 'Defina as condições de roteamento.',
  },
];

const errorPolicyOptions: Array<{
  value: ErrorPolicy;
  label: string;
  description: string;
}> = [
  {
    value: 'auto_repair',
    label: 'Auto-corrigir',
    description: 'Tenta decompor a etapa em ferramentas compatíveis antes de falhar.',
  },
  {
    value: 'best_effort',
    label: 'Melhor esforço',
    description: 'Executa a parte que a ferramenta selecionada consegue cobrir.',
  },
  {
    value: 'continue',
    label: 'Continuar',
    description: 'Registra aviso e segue para a próxima etapa.',
  },
  {
    value: 'stop',
    label: 'Parar',
    description: 'Interrompe o fluxo no primeiro erro desta etapa.',
  },
];

async function readJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || text || `HTTP ${res.status}`);
  return data as T;
}

async function postJson<T>(url: string, body: unknown, rejectOnFalse = true): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok || (rejectOnFalse && data.ok === false)) {
    const failedStage = Array.isArray(data.results) ? data.results.find((item: HarnessRunStageResult) => item && !item.ok) : null;
    throw new Error(data.error || failedStage?.error || text || `HTTP ${res.status}`);
  }
  return data as T;
}

function kindLabel(kind: StageKind) {
  return stageTemplates.find((item) => item.kind === kind)?.label || kind;
}

function toneClass(ok?: boolean) {
  if (ok === true) return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200';
  if (ok === false) return 'border-red-400/25 bg-red-400/10 text-red-200';
  return 'border-white/10 bg-[#12161d] text-white/60';
}

function statusLabel(status: RunStageStatus) {
  if (status === 'running') return 'rodando';
  if (status === 'ok') return 'ok';
  if (status === 'error') return 'erro';
  return 'fila';
}

function statusTone(status: RunStageStatus) {
  if (status === 'running') return 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100';
  if (status === 'ok') return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200';
  if (status === 'error') return 'border-red-400/25 bg-red-400/10 text-red-200';
  return 'border-white/10 bg-[#12161d] text-white/55';
}

function normalizedErrorPolicy(stage?: Pick<HarnessStage, 'errorPolicy'> | null): ErrorPolicy {
  const policy = stage?.errorPolicy;
  return errorPolicyOptions.some((item) => item.value === policy) ? policy as ErrorPolicy : 'auto_repair';
}

function errorPolicyLabel(policy?: string) {
  return errorPolicyOptions.find((item) => item.value === policy)?.label || 'Auto-corrigir';
}

function StatusIcon({ status }: { status: RunStageStatus }) {
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin" />;
  if (status === 'ok') return <Check className="h-4 w-4" />;
  if (status === 'error') return <AlertTriangle className="h-4 w-4" />;
  return <Clock3 className="h-4 w-4" />;
}

function makeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `stage-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function HarnessPage() {
  const theme = useTheme();
  const [engines, setEngines] = useState<EnginesResponse | null>(null);
  const [tools, setTools] = useState<ToolSpec[]>([]);
  const [personas, setPersonas] = useState<PersonaSpec[]>([]);
  const [stages, setStages] = usePersistentState<HarnessStage[]>('harness.stages', []);
  const [selectedStageId, setSelectedStageId] = usePersistentState<string | null>('harness.selectedStageId', null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<HarnessRunResponse | null>(null);
  const [runOverlayOpen, setRunOverlayOpen] = useState(false);
  const [runProgress, setRunProgress] = useState<HarnessRunVisualStage[]>([]);
  const [activeRunStageId, setActiveRunStageId] = useState<string | null>(null);

  const engineRows = engines?.models || [];
  const executableTools = useMemo(() => tools.filter((tool) => tool.executable), [tools]);
  const selectedStage = stages.find((stage) => stage.id === selectedStageId) || stages[0] || null;
  const activeRunStage = runProgress.find((stage) => stage.id === activeRunStageId)
    || runProgress.find((stage) => stage.status === 'running')
    || runProgress[0]
    || null;
  const runCompleted = runProgress.filter((stage) => stage.status === 'ok').length;
  const runFailed = runProgress.filter((stage) => stage.status === 'error').length;
  const canOpenMonitor = runProgress.length > 0 || Boolean(runResult || runError);

  async function loadHarnessBase() {
    setLoading(true);
    setError(null);
    try {
      const [modelData, toolData, personaData] = await Promise.all([
        readJson<EnginesResponse>('/api/tars/chat/models'),
        readJson<ToolsResponse>('/api/tars/tools'),
        readJson<PersonasResponse>('/api/tars/yume/personas'),
      ]);
      setEngines(modelData);
      setTools(toolData.tools || []);
      setPersonas(personaData.personas || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHarnessBase();
  }, []);

  function defaultModel() {
    return engines?.active?.model || engineRows[0]?.id || 'glm-5.1';
  }

  function defaultPersona() {
    return personas.find((persona) => persona.slug === 'tars')?.slug || personas[0]?.slug || 'tars';
  }

  function defaultTool(kind: StageKind) {
    if (kind === 'tool') return executableTools[0]?.id || tools[0]?.id || '';
    return '';
  }

  function clearRunState() {
    setRunError(null);
    setRunResult(null);
    setRunProgress([]);
    setActiveRunStageId(null);
    setRunOverlayOpen(false);
  }

  function addStage(kind: StageKind) {
    const template = stageTemplates.find((item) => item.kind === kind) || stageTemplates[0];
    const next: HarnessStage = {
      id: makeId(),
      title: template.defaultTitle,
      kind,
      model: defaultModel(),
      persona: defaultPersona(),
      tool: defaultTool(kind),
      instruction: template.defaultInstruction,
      errorPolicy: 'auto_repair',
    };
    clearRunState();
    setStages((current) => [...current, next]);
    setSelectedStageId(next.id);
  }

  function updateStage(id: string, patch: Partial<HarnessStage>) {
    clearRunState();
    setStages((current) => current.map((stage) => (
      stage.id === id ? { ...stage, ...patch } : stage
    )));
  }

  function removeStage(id: string) {
    clearRunState();
    setStages((current) => current.filter((stage) => stage.id !== id));
    if (selectedStageId === id) setSelectedStageId(null);
  }

  function moveStage(id: string, direction: -1 | 1) {
    clearRunState();
    setStages((current) => {
      const index = current.findIndex((stage) => stage.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function runFlow() {
    if (stages.length === 0 || running) return;
    const executableStages = stages.map((stage) => ({
      ...stage,
      errorPolicy: normalizedErrorPolicy(stage),
    }));
    const flowStages: HarnessRunVisualStage[] = executableStages.map((stage, index) => ({
      ...stage,
      index: index + 1,
      status: 'queued',
    }));
    const traceId = makeId();
    const startedAt = Date.now();
    const contextChunks: string[] = [];
    const results: HarnessRunStageResult[] = [];

    setRunning(true);
    setRunError(null);
    setRunResult(null);
    setRunProgress(flowStages);
    setActiveRunStageId(flowStages[0]?.id || null);
    setRunOverlayOpen(true);

    try {
      for (const visualStage of flowStages) {
        const stage = executableStages[visualStage.index - 1];
        setActiveRunStageId(stage.id);
        setRunProgress((current) => current.map((item) => (
          item.id === stage.id ? { ...item, status: 'running' } : item
        )));

        const result = await postJson<HarnessRunResponse>('/api/tars/harness/execute', {
          stages: [stage],
          context: contextChunks,
          trace_id: traceId,
          start_index: visualStage.index,
          max_tokens: 1600,
        }, false);
        const stageResult = result.results?.[0] || {
          index: visualStage.index,
          id: stage.id,
          title: stage.title,
          kind: stage.kind,
          ok: Boolean(result.ok),
          output: result.final_output || '',
          error: result.error,
        };
        results.push(stageResult);

        setRunProgress((current) => current.map((item) => (
          item.id === stage.id
            ? { ...item, status: stageResult.ok ? 'ok' : 'error', result: stageResult }
            : item
        )));

        if (!stageResult.ok) {
          throw new Error(stageResult.error || result.error || `Etapa ${visualStage.index} falhou`);
        }

        contextChunks.push(`### ${stage.title}\n${String(stageResult.output || '').slice(0, 4000)}`);
      }

      setRunResult({
        ok: true,
        trace_id: traceId,
        elapsed_ms: Date.now() - startedAt,
        count: flowStages.length,
        completed: results.length,
        results,
        final_output: results[results.length - 1]?.output || '',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRunError(message);
      setRunProgress((current) => current.map((item) => (
        item.status === 'running'
          ? {
              ...item,
              status: 'error',
              result: {
                index: item.index,
                id: item.id,
                title: item.title,
                kind: item.kind,
                ok: false,
                model: item.model,
                persona: item.persona,
                tool: item.tool || null,
                error: message,
              },
            }
          : item
      )));
      setRunResult({
        ok: false,
        trace_id: traceId,
        elapsed_ms: Date.now() - startedAt,
        count: flowStages.length,
        completed: results.filter((item) => item.ok).length,
        results,
        final_output: results[results.length - 1]?.output || '',
        error: message,
      });
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="flex items-center gap-3 text-sm tracking-[0.2em] uppercase" style={{ color: theme.textMute }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          carregando harness
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-7rem)] space-y-4">
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg border border-white/10 bg-[#10141a] p-4 shadow-[0_18px_42px_rgba(0,0,0,0.24)]"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="panel-kicker">
              <FlaskConical className="h-3.5 w-3.5" />
              harness blackboard
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight" style={{ color: theme.text }}>
              Harness
            </h1>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {[
              ['etapas', String(stages.length)],
              ['motores', String(engineRows.length)],
              ['personas', String(personas.length)],
              ['tools', String(executableTools.length)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-white/10 bg-[#0b0e13] px-3 py-2">
                <div className="text-[9px] uppercase tracking-[0.18em]" style={{ color: theme.textGhost }}>{label}</div>
                <div className="mt-0.5 text-sm font-semibold" style={{ color: theme.text }}>{value}</div>
              </div>
            ))}
            <button
              type="button"
              onClick={loadHarnessBase}
              className="btn-rift inline-flex items-center justify-center gap-2 px-3 py-2 text-xs"
              title="Recarregar recursos"
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

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)_380px]">
        <aside className="rounded-lg border border-white/10 bg-[#10141a] p-4">
          <div className="panel-kicker mb-4">
            <CirclePlus className="h-3.5 w-3.5" />
            criar etapa
          </div>
          <div className="space-y-2">
            {stageTemplates.map((template) => {
              const Icon = template.icon;
              return (
                <button
                  key={template.kind}
                  type="button"
                  onClick={() => addStage(template.kind)}
                  className="w-full rounded-md border border-white/10 bg-[#0b0e13] p-3 text-left transition-colors hover:border-white/20 hover:bg-[#131821]"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4" style={{ color: theme.textSoft }} />
                    <span className="text-sm font-semibold" style={{ color: theme.text }}>{template.label}</span>
                  </div>
                  <div className="mt-1 text-xs leading-relaxed" style={{ color: theme.textMute }}>
                    {template.description}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="rounded-lg border border-white/10 bg-[#10141a] p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="panel-kicker">
              <Route className="h-3.5 w-3.5" />
              fluxo
            </div>
            <div className="text-xs font-mono" style={{ color: theme.textGhost }}>
              {stages.length} etapas
            </div>
          </div>

          {stages.length === 0 ? (
            <div className="flex min-h-[430px] items-center justify-center rounded-lg border border-dashed border-white/10 bg-[#0b0e13] p-6 text-center">
              <div>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-white/10 bg-[#12161d]">
                  <FlaskConical className="h-5 w-5" style={{ color: theme.textMute }} />
                </div>
                <div className="mt-4 text-sm font-medium" style={{ color: theme.text }}>
                  Blackboard vazio
                </div>
                <div className="mt-1 max-w-md text-xs leading-relaxed" style={{ color: theme.textMute }}>
                  Use a paleta lateral para criar a primeira etapa do fluxo. Cada etapa terá modelo LLM e persona próprios.
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {stages.map((stage, index) => {
                const isSelected = selectedStage?.id === stage.id;
                return (
                  <article
                    key={stage.id}
                    className="rounded-lg border bg-[#0b0e13] p-4 transition-colors"
                    style={{ borderColor: isSelected ? theme.borderActive : 'rgba(223,230,238,0.10)' }}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedStageId(stage.id)}
                      className="block w-full text-left"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="rounded border border-white/10 bg-[#12161d] px-2 py-1 font-mono text-[10px]" style={{ color: theme.textMute }}>
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <span className={`rounded border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${toneClass(true)}`}>
                              {kindLabel(stage.kind)}
                            </span>
                          </div>
                          <h2 className="mt-3 truncate text-base font-semibold" style={{ color: theme.text }}>
                            {stage.title}
                          </h2>
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px]" style={{ color: theme.textMute }}>
                            <span className="rounded border border-white/10 bg-[#12161d] px-2 py-1">
                              <BrainCircuit className="mr-1 inline h-3 w-3" />
                              {stage.model}
                            </span>
                            <span className="rounded border border-white/10 bg-[#12161d] px-2 py-1">
                              <Bot className="mr-1 inline h-3 w-3" />
                              {stage.persona}
                            </span>
                            {stage.tool && (
                              <span className="rounded border border-white/10 bg-[#12161d] px-2 py-1">
                                <Wrench className="mr-1 inline h-3 w-3" />
                                {stage.tool}
                              </span>
                            )}
                            <span className="rounded border border-white/10 bg-[#12161d] px-2 py-1">
                              <AlertTriangle className="mr-1 inline h-3 w-3" />
                              {errorPolicyLabel(normalizedErrorPolicy(stage))}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>

                    <div className="mt-3 rounded-md border border-white/10 bg-[#10141a] p-3 text-xs leading-relaxed" style={{ color: theme.textSoft }}>
                      {stage.instruction}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </main>

        <aside className="space-y-4">
          <div className="rounded-lg border border-white/10 bg-[#10141a] p-4">
            <div className="panel-kicker mb-4">
              <BrainCircuit className="h-3.5 w-3.5" />
              etapa selecionada
            </div>

            {selectedStage ? (
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.16em]" style={{ color: theme.textGhost }}>nome</span>
                  <input
                    value={selectedStage.title}
                    onChange={(event) => updateStage(selectedStage.id, { title: event.target.value })}
                    className="w-full rounded-md border border-white/10 bg-[#0b0e13] px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/40"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.16em]" style={{ color: theme.textGhost }}>modelo LLM</span>
                  <select
                    value={selectedStage.model}
                    onChange={(event) => updateStage(selectedStage.id, { model: event.target.value })}
                    className="w-full rounded-md border border-white/10 bg-[#0b0e13] px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/40"
                  >
                    {engineRows.map((engine) => (
                      <option key={engine.id} value={engine.id}>
                        {engine.id}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.16em]" style={{ color: theme.textGhost }}>persona</span>
                  <select
                    value={selectedStage.persona}
                    onChange={(event) => updateStage(selectedStage.id, { persona: event.target.value })}
                    className="w-full rounded-md border border-white/10 bg-[#0b0e13] px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/40"
                  >
                    {personas.length === 0 && <option value="tars">tars</option>}
                    {personas.map((persona) => (
                      <option key={persona.slug} value={persona.slug}>
                        {persona.name} ({persona.slug})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.16em]" style={{ color: theme.textGhost }}>ferramenta</span>
                  <select
                    value={selectedStage.tool}
                    onChange={(event) => updateStage(selectedStage.id, { tool: event.target.value })}
                    className="w-full rounded-md border border-white/10 bg-[#0b0e13] px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/40"
                  >
                    <option value="">sem ferramenta</option>
                    {tools.map((tool) => (
                      <option key={tool.id} value={tool.id}>
                        {tool.id}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.16em]" style={{ color: theme.textGhost }}>ao encontrar erro</span>
                  <select
                    value={normalizedErrorPolicy(selectedStage)}
                    onChange={(event) => updateStage(selectedStage.id, { errorPolicy: event.target.value as ErrorPolicy })}
                    className="w-full rounded-md border border-white/10 bg-[#0b0e13] px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/40"
                  >
                    {errorPolicyOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11px] leading-relaxed" style={{ color: theme.textMute }}>
                    {errorPolicyOptions.find((option) => option.value === normalizedErrorPolicy(selectedStage))?.description}
                  </span>
                </label>

                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.16em]" style={{ color: theme.textGhost }}>instrução</span>
                  <textarea
                    value={selectedStage.instruction}
                    onChange={(event) => updateStage(selectedStage.id, { instruction: event.target.value })}
                    className="min-h-[116px] w-full resize-y rounded-md border border-white/10 bg-[#0b0e13] px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/40"
                  />
                </label>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => moveStage(selectedStage.id, -1)}
                    className="btn-rift inline-flex items-center justify-center gap-2 px-3 py-2 text-xs"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                    Subir
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStage(selectedStage.id, 1)}
                    className="btn-rift inline-flex items-center justify-center gap-2 px-3 py-2 text-xs"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                    Descer
                  </button>
                  <button
                    type="button"
                    onClick={() => removeStage(selectedStage.id)}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-200"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remover
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-white/10 bg-[#0b0e13] p-4 text-sm" style={{ color: theme.textMute }}>
                Crie uma etapa para editar modelo, persona, ferramenta e instrução.
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={runFlow}
            disabled={stages.length === 0 || running}
            className={[
              'btn-rift inline-flex min-h-[42px] w-full items-center justify-center gap-2 px-4 text-sm',
              stages.length === 0 || running ? 'cursor-not-allowed opacity-45' : 'hover:border-emerald-400/40 hover:text-emerald-100',
            ].join(' ')}
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? 'Executando' : 'Executar fluxo'}
          </button>

          {canOpenMonitor && !runOverlayOpen && (
            <button
              type="button"
              onClick={() => setRunOverlayOpen(true)}
              className="btn-rift inline-flex min-h-[38px] w-full items-center justify-center gap-2 px-4 text-xs"
            >
              <ListChecks className="h-3.5 w-3.5" />
              Abrir monitor
            </button>
          )}

          {runError && (
            <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">
              {runError}
            </div>
          )}

          {runResult && (
            <div className="rounded-lg border border-white/10 bg-[#10141a] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="panel-kicker">
                  <Check className="h-3.5 w-3.5" />
                  resultado
                </div>
                <span className={`rounded border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${toneClass(runResult.ok)}`}>
                  {runResult.completed || 0}/{runResult.count || stages.length}
                </span>
              </div>

              <div className="space-y-2">
                {(runResult.results || []).map((item) => (
                  <div key={item.id || item.index} className="rounded-md border border-white/10 bg-[#0b0e13] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium" style={{ color: theme.text }}>
                          {String(item.index).padStart(2, '0')} · {item.title}
                        </div>
                        <div className="mt-1 text-[11px]" style={{ color: theme.textMute }}>
                          {[item.provider, item.tool, item.elapsed_ms ? `${item.elapsed_ms}ms` : null].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${toneClass(item.ok)}`}>
                        {item.recovered ? 'recuperado' : item.partial ? 'parcial' : item.ok ? 'ok' : 'erro'}
                      </span>
                    </div>
                    {(item.error || item.warning || item.output) && (
                      <div className="mt-2 max-h-28 overflow-auto rounded border border-white/10 bg-[#10141a] p-2 text-xs leading-relaxed" style={{ color: item.error && !item.ok ? '#fecaca' : theme.textSoft }}>
                        {item.error && !item.ok ? item.error : item.warning || item.output}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {runResult.trace_id && (
                <div className="mt-3 truncate font-mono text-[10px]" style={{ color: theme.textGhost }}>
                  trace {runResult.trace_id}
                </div>
              )}
            </div>
          )}
        </aside>
      </section>

      {runOverlayOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/68 px-4 py-5 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="flex max-h-[calc(100vh-2.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-white/10 bg-[#0d1015] shadow-[0_28px_90px_rgba(0,0,0,0.55)]"
          >
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-[#10141a] px-4 py-3">
              <div className="min-w-0">
                <div className="panel-kicker">
                  <ListChecks className="h-3.5 w-3.5" />
                  monitor do fluxo
                </div>
                <h2 className="mt-1 truncate text-lg font-semibold" style={{ color: theme.text }}>
                  {running ? 'Execução em andamento' : runResult?.ok ? 'Fluxo concluído' : runResult ? 'Fluxo interrompido' : 'Fluxo preparado'}
                </h2>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${runFailed ? statusTone('error') : running ? statusTone('running') : statusTone(runResult?.ok ? 'ok' : 'queued')}`}>
                  {runCompleted}/{runProgress.length || stages.length}
                </span>
                {runResult?.trace_id && (
                  <span className="hidden max-w-[220px] truncate rounded border border-white/10 bg-[#0b0e13] px-2 py-1 font-mono text-[10px] sm:inline" style={{ color: theme.textMute }}>
                    {runResult.trace_id}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setRunOverlayOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-[#0b0e13] text-white/70 transition-colors hover:border-white/20 hover:text-white"
                  title="Fechar monitor"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(340px,0.85fr)_minmax(0,1.15fr)]">
              <section className="min-h-0 overflow-y-auto border-b border-white/10 p-4 lg:border-b-0 lg:border-r">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="panel-kicker">
                    <Route className="h-3.5 w-3.5" />
                    linha de execução
                  </div>
                  {running && (
                    <span className="flex items-center gap-2 text-xs" style={{ color: theme.textMute }}>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      chamadas ativas
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  {runProgress.map((stage) => (
                    <button
                      key={stage.id}
                      type="button"
                      onClick={() => setActiveRunStageId(stage.id)}
                      className="w-full rounded-md border bg-[#0b0e13] p-3 text-left transition-colors hover:border-white/20"
                      style={{ borderColor: activeRunStage?.id === stage.id ? theme.borderActive : 'rgba(223,230,238,0.10)' }}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${statusTone(stage.status)}`}>
                          <StatusIcon status={stage.status} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded border border-white/10 bg-[#12161d] px-2 py-1 font-mono text-[10px]" style={{ color: theme.textMute }}>
                              {String(stage.index).padStart(2, '0')}
                            </span>
                            <span className={`rounded border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${statusTone(stage.status)}`}>
                              {statusLabel(stage.status)}
                            </span>
                            <span className="rounded border border-white/10 bg-[#12161d] px-2 py-1 text-[10px] uppercase tracking-[0.12em]" style={{ color: theme.textMute }}>
                              {kindLabel(stage.kind)}
                            </span>
                          </div>
                          <div className="mt-2 truncate text-sm font-semibold" style={{ color: theme.text }}>
                            {stage.title}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]" style={{ color: theme.textMute }}>
                            <span className="rounded border border-white/10 bg-[#10141a] px-2 py-0.5">{stage.model}</span>
                            <span className="rounded border border-white/10 bg-[#10141a] px-2 py-0.5">{stage.persona}</span>
                            {stage.tool && <span className="rounded border border-white/10 bg-[#10141a] px-2 py-0.5">{stage.tool}</span>}
                            <span className="rounded border border-white/10 bg-[#10141a] px-2 py-0.5">{errorPolicyLabel(normalizedErrorPolicy(stage))}</span>
                            {stage.result?.elapsed_ms && <span className="rounded border border-white/10 bg-[#10141a] px-2 py-0.5">{stage.result.elapsed_ms}ms</span>}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="min-h-0 overflow-y-auto p-4">
                {activeRunStage ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-white/10 bg-[#10141a] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="panel-kicker">
                            <BrainCircuit className="h-3.5 w-3.5" />
                            etapa ativa
                          </div>
                          <h3 className="mt-2 truncate text-base font-semibold" style={{ color: theme.text }}>
                            {String(activeRunStage.index).padStart(2, '0')} · {activeRunStage.title}
                          </h3>
                        </div>
                        <span className={`rounded border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${statusTone(activeRunStage.status)}`}>
                          {statusLabel(activeRunStage.status)}
                        </span>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-4">
                        <div className="rounded-md border border-white/10 bg-[#0b0e13] p-3">
                          <div className="text-[9px] uppercase tracking-[0.16em]" style={{ color: theme.textGhost }}>modelo</div>
                          <div className="mt-1 truncate text-xs font-medium" style={{ color: theme.text }}>{activeRunStage.model}</div>
                        </div>
                        <div className="rounded-md border border-white/10 bg-[#0b0e13] p-3">
                          <div className="text-[9px] uppercase tracking-[0.16em]" style={{ color: theme.textGhost }}>persona</div>
                          <div className="mt-1 truncate text-xs font-medium" style={{ color: theme.text }}>{activeRunStage.persona}</div>
                        </div>
                        <div className="rounded-md border border-white/10 bg-[#0b0e13] p-3">
                          <div className="text-[9px] uppercase tracking-[0.16em]" style={{ color: theme.textGhost }}>ferramenta</div>
                          <div className="mt-1 truncate text-xs font-medium" style={{ color: theme.text }}>{activeRunStage.tool || 'sem ferramenta'}</div>
                        </div>
                        <div className="rounded-md border border-white/10 bg-[#0b0e13] p-3">
                          <div className="text-[9px] uppercase tracking-[0.16em]" style={{ color: theme.textGhost }}>em erro</div>
                          <div className="mt-1 truncate text-xs font-medium" style={{ color: theme.text }}>{errorPolicyLabel(normalizedErrorPolicy(activeRunStage))}</div>
                        </div>
                      </div>

                      <div className="mt-4 rounded-md border border-white/10 bg-[#0b0e13] p-3">
                        <div className="mb-2 text-[9px] uppercase tracking-[0.16em]" style={{ color: theme.textGhost }}>instrução</div>
                        <div className="text-xs leading-relaxed" style={{ color: theme.textSoft }}>
                          {activeRunStage.instruction}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-[#10141a] p-4">
                      <div className="panel-kicker mb-3">
                        <Wrench className="h-3.5 w-3.5" />
                        chamadas
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="rounded-md border border-white/10 bg-[#0b0e13] p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold" style={{ color: theme.text }}>LLM</span>
                            <span className={`rounded border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${activeRunStage.kind === 'tool' ? statusTone('queued') : statusTone(activeRunStage.status)}`}>
                              {activeRunStage.kind === 'tool' ? 'ignorado' : statusLabel(activeRunStage.status)}
                            </span>
                          </div>
                          <div className="mt-2 truncate text-[11px]" style={{ color: theme.textMute }}>
                            {activeRunStage.result?.provider || activeRunStage.model}
                          </div>
                        </div>
                        <div className="rounded-md border border-white/10 bg-[#0b0e13] p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold" style={{ color: theme.text }}>Tool</span>
                            <span className={`rounded border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${activeRunStage.tool ? statusTone(activeRunStage.status) : statusTone('queued')}`}>
                              {activeRunStage.tool ? statusLabel(activeRunStage.status) : 'nenhuma'}
                            </span>
                          </div>
                          <div className="mt-2 truncate text-[11px]" style={{ color: theme.textMute }}>
                            {activeRunStage.tool || 'sem chamada de ferramenta'}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-[#10141a] p-4">
                      <div className="panel-kicker mb-3">
                        <Check className="h-3.5 w-3.5" />
                        saída
                      </div>
                      {activeRunStage.result?.error && !activeRunStage.result.ok ? (
                        <div className="rounded-md border border-red-400/20 bg-red-400/10 p-3 text-sm leading-relaxed text-red-200">
                          {activeRunStage.result.error}
                        </div>
                      ) : activeRunStage.result?.warning ? (
                        <div className="rounded-md border border-amber-300/20 bg-amber-300/10 p-3 text-sm leading-relaxed text-amber-100">
                          {activeRunStage.result.warning}
                        </div>
                      ) : activeRunStage.result?.output ? (
                        <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-[#0b0e13] p-3 text-xs leading-relaxed" style={{ color: theme.textSoft }}>
                          {activeRunStage.result.output}
                        </pre>
                      ) : (
                        <div className="rounded-md border border-dashed border-white/10 bg-[#0b0e13] p-4 text-sm" style={{ color: theme.textMute }}>
                          {activeRunStage.status === 'running' ? 'Aguardando retorno desta chamada.' : 'Esta etapa ainda não produziu saída.'}
                        </div>
                      )}
                    </div>

                    {runError && (
                      <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">
                        {runError}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed border-white/10 bg-[#10141a] p-6 text-center text-sm" style={{ color: theme.textMute }}>
                    Nenhuma execução registrada ainda.
                  </div>
                )}
              </section>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
