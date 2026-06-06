import {
  Activity,
  Bot,
  Boxes,
  Cable,
  CheckCircle2,
  Cpu,
  Database,
  GitBranch,
  HeartPulse,
  Mic2,
  Play,
  RadioTower,
  ShieldCheck,
  Target,
  Terminal,
  Wrench,
} from 'lucide-react';
import OrbitalScene from './OrbitalScene';

const tools = [
  'shell_exec',
  'fs_read/write/list',
  'web_search/fetch',
  'grok_imagine',
  'kamui_call',
  'spawn_subagent',
  'mission_log',
  'memory_recall',
];

const features = [
  {
    icon: Target,
    title: 'Objetivos com critério de sucesso',
    text: 'Cada missão carrega definition_of_done, limites de iteração, tempo e chamadas de ferramenta. O trabalho não termina no primeiro texto bonito.',
  },
  {
    icon: ShieldCheck,
    title: 'Verificador adversarial separado',
    text: 'O executor age, outro juiz tenta reprovar o resultado e devolve pendências. Essa divisão reduz conclusões prematuras.',
  },
  {
    icon: Wrench,
    title: 'Ferramentas reais, auditadas em echoes',
    text: 'Terminal, arquivos, web, memória, imagem, subagentes e bridges passam por um executor unificado com observação persistida.',
  },
  {
    icon: Cable,
    title: 'Hub para Kamui, Yume e VideoGen',
    text: 'O TARS recebe trabalho direto ou via Kamui e chama outros serviços pelo proxy de bridges, mantendo o ecossistema operável.',
  },
];

const workflow = [
  ['1', 'Recebe trabalho', 'POST /api/tars/work aceita task, description, definition_of_done, budget e callback_url.'],
  ['2', 'Planeja e age', 'O loop ReAct escolhe ferramentas, observa saídas e registra cada passo em goal_steps e echoes.'],
  ['3', 'Verifica', 'Um verificador separado tenta provar que a missão não acabou e força nova iteração quando falta prova.'],
  ['4', 'Entrega', 'O status fica disponível em /work/{job_id}; callbacks outbound enviam o resultado para quem delegou.'],
];

const useCases = [
  'Gerar assets com Grok Imagine e salvar em paths governados',
  'Disparar pipelines de vídeo via Kamui e acompanhar operações',
  'Executar scripts, validar saída e anexar evidências',
  'Operar voz contínua com OmniVoice e fallback local',
  'Delegar trabalho de outros serviços para o runtime do TARS',
  'Auditar endpoints e catálogos do ecossistema local',
];

function App() {
  return (
    <main>
      <section className="hero" id="top">
        <img className="hero-video" src="/assets/tars-og.jpg" alt="" />
        <div className="hero-shade" />
        <OrbitalScene />

        <nav className="nav" aria-label="Principal">
          <a className="brand" href="#top" aria-label="TARS">
            <img src="/assets/tars-logo.svg" alt="" />
            <span>TARS</span>
          </a>
          <div className="nav-links">
            <a href="#workflow">Workflow</a>
            <a href="#features">Recursos</a>
            <a href="#ops">Operação</a>
          </div>
        </nav>

        <div className="hero-copy">
          <p className="eyebrow">runtime local de agente autônomo</p>
          <h1>TARS executa trabalho real, verifica o resultado e entrega de volta.</h1>
          <p className="lead">
            Um companion de bordo para o ecossistema Kamui: recebe objetivos, chama ferramentas reais,
            cruza bridges com outros serviços e só encerra uma missão quando há prova suficiente.
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#workflow">
              <Play aria-hidden="true" />
              Ver como funciona
            </a>
            <a className="secondary-action" href="http://127.0.0.1:62025/" target="_blank" rel="noreferrer">
              Abrir dashboard
            </a>
          </div>
        </div>

        <div className="hero-status" aria-label="Resumo operacional">
          <div>
            <span>Backend</span>
            <strong>:62026</strong>
          </div>
          <div>
            <span>Dashboard</span>
            <strong>:62025</strong>
          </div>
          <div>
            <span>Tools</span>
            <strong>18</strong>
          </div>
          <div>
            <span>Bridges</span>
            <strong>Kamui/Yume</strong>
          </div>
        </div>
      </section>

      <section className="mission-band" aria-label="Posicionamento">
        <div className="section-shell mission-intro">
          <div>
            <p className="eyebrow">space exploration companion</p>
            <h2>Do chat ao runtime que segura a missão inteira.</h2>
          </div>
          <p>
            O TARS combina persona, catálogo JSON de ferramentas, memória persistente, governança conservadora e
            um loop ReAct com verificação adversarial. Ele foi desenhado para operar em localhost como um serviço
            confiável para outros sistemas, não apenas responder mensagens.
          </p>
        </div>
      </section>

      <section className="section-shell workflow" id="workflow">
        <div className="section-heading">
          <p className="eyebrow">como funciona</p>
          <h2>Uma missão vira um contrato executável.</h2>
        </div>
        <div className="workflow-grid">
          {workflow.map(([step, title, text]) => (
            <article className="step" key={step}>
              <span>{step}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
        <div className="code-strip" aria-label="Exemplo de chamada">
          <Terminal aria-hidden="true" />
          <code>POST /api/tars/work {'{ task, definition_of_done, budget, callback_url }'}</code>
        </div>
      </section>

      <section className="visual-section" id="ops">
        <div className="section-shell visual-grid">
          <div className="visual-copy">
            <p className="eyebrow">painel operacional</p>
            <h2>O cockpit mostra fila, eventos, ferramentas e presença de voz.</h2>
            <p>
              O dashboard Vite/React acompanha goals, heartbeat, event stream, bridges e ferramentas. A página de
              Missões permite lançar trabalho e ver raciocínio, ação, observação e verificação ao vivo.
            </p>
            <div className="ops-list">
              <span><Activity aria-hidden="true" /> event stream persistido</span>
              <span><HeartPulse aria-hidden="true" /> heartbeat proativo desligado por padrão</span>
              <span><Mic2 aria-hidden="true" /> voz clonada via OmniVoice</span>
            </div>
          </div>
          <figure className="dashboard-frame">
            <img src="/assets/dashboard-runtime.png" alt="Dashboard do TARS exibindo runtime, objetivos recentes e event stream." />
          </figure>
        </div>
      </section>

      <section className="section-shell features" id="features">
        <div className="section-heading">
          <p className="eyebrow">recursos principais</p>
          <h2>Arquitetura feita para autonomia local, não para demo descartável.</h2>
        </div>
        <div className="feature-grid">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <article className="feature" key={feature.title}>
                <Icon aria-hidden="true" />
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="section-shell architecture">
        <div className="section-heading">
          <p className="eyebrow">superfície real</p>
          <h2>Backend FastAPI, dashboard Vite e bridges como primeira classe.</h2>
        </div>
        <div className="arch-grid">
          <article>
            <Cpu aria-hidden="true" />
            <h3>Loop agêntico</h3>
            <p>backend/agent.py roda planejar, agir, observar, verificar e repetir com limites de segurança.</p>
          </article>
          <article>
            <Database aria-hidden="true" />
            <h3>Memória e auditoria</h3>
            <p>SQLite guarda personas, goals, goal_steps, memories, mission_log, bridge health e echoes.</p>
          </article>
          <article>
            <RadioTower aria-hidden="true" />
            <h3>Serviço delegável</h3>
            <p>/api/tars/work recebe jobs assíncronos e entrega callback quando a missão termina.</p>
          </article>
          <article>
            <GitBranch aria-hidden="true" />
            <h3>Ecossistema</h3>
            <p>Kamui é o acesso padrão para outros serviços; Yume e VideoGen entram como pontes operacionais.</p>
          </article>
        </div>
      </section>

      <section className="tools-band">
        <div className="section-shell tools-layout">
          <div>
            <p className="eyebrow">arsenal</p>
            <h2>18 ferramentas executáveis no catálogo.</h2>
          </div>
          <div className="tool-cloud" aria-label="Ferramentas do TARS">
            {tools.map((tool) => <span key={tool}>{tool}</span>)}
          </div>
        </div>
      </section>

      <section className="section-shell use-cases">
        <div className="section-heading">
          <p className="eyebrow">casos de uso</p>
          <h2>Trabalho de longa duração com evidência no final.</h2>
        </div>
        <div className="use-grid">
          {useCases.map((item) => (
            <div className="use-row" key={item}>
              <CheckCircle2 aria-hidden="true" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="voice-band">
        <div className="section-shell voice-grid">
          <figure className="voice-frame">
            <img src="/assets/dashboard-voice.png" alt="Interface de voz do TARS com monitoramento, TTS e decisões do detector." />
          </figure>
          <div>
            <p className="eyebrow">presença de voz</p>
            <h2>O companion também escuta, julga contexto e fala quando precisa.</h2>
            <p>
              A camada de voz usa OmniVoice via ponte Kamui como motor principal e cai para SpeechSynthesis local
              quando necessário. O monitoramento combina VAD, STT e um juiz LLM para decidir se a intervenção vale a pena.
            </p>
          </div>
        </div>
      </section>

      <section className="final-cta">
        <div className="section-shell final-inner">
          <Bot aria-hidden="true" />
          <h2>Coloque o TARS em órbita local.</h2>
          <p>Suba backend e dashboard, delegue uma missão e acompanhe o rastro completo de execução.</p>
          <div className="command-row">
            <code>.\start-tars.ps1</code>
            <a className="primary-action" href="http://127.0.0.1:62025/" target="_blank" rel="noreferrer">Abrir cockpit</a>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
