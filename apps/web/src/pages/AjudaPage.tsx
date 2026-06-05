import { useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  GraduationCap,
  LayoutDashboard,
  LifeBuoy,
  type LucideIcon,
  Presentation,
  School,
  Settings,
  TrendingUp,
} from 'lucide-react';
import { useAuth, type Role } from '../auth/AuthProvider';

type Section = {
  id: string;
  title: string;
  icon: LucideIcon;
  roles: Role[];
  intro: string;
  steps: string[];
};

// Capturas reais de cada tela (servidas de apps/web/public/tutorial/).
const SHOTS: Record<string, string[]> = {
  inicio: ['/tutorial/inicio-1.png', '/tutorial/inicio-2.png'],
  dashboard: ['/tutorial/dashboard-1.png'],
  vendas: ['/tutorial/vendas-1.png'],
  agenda: ['/tutorial/agenda-1.png', '/tutorial/agenda-2.png'],
  presenca: ['/tutorial/presenca-1.png'],
  alunos: ['/tutorial/alunos-1.png', '/tutorial/alunos-2.png'],
  professores: ['/tutorial/professores-1.png'],
  escolas: ['/tutorial/escolas-1.png', '/tutorial/escolas-2.png'],
  configuracoes: ['/tutorial/configuracoes-1.png'],
};

/** Carrossel de screenshots de uma seção. Sem imagens, não renderiza nada. */
function Carousel({ shots, title }: { shots: string[]; title: string }) {
  const [i, setI] = useState(0);
  if (shots.length === 0) return null;
  const many = shots.length > 1;
  const go = (delta: number) => setI((p) => (p + delta + shots.length) % shots.length);

  return (
    <figure className={`ajuda-carousel${many ? ' is-many' : ''}`}>
      <img
        className="ajuda-shot"
        src={shots[i]}
        alt={`${title} — imagem ${i + 1} de ${shots.length}`}
        loading="lazy"
        onClick={() => many && go(1)}
      />
      {many && (
        <>
          <button type="button" className="ajuda-car-nav prev" onClick={() => go(-1)} aria-label="Imagem anterior">
            <ChevronLeft size={20} />
          </button>
          <button type="button" className="ajuda-car-nav next" onClick={() => go(1)} aria-label="Próxima imagem">
            <ChevronRight size={20} />
          </button>
          <figcaption className="ajuda-car-dots">
            {shots.map((_, k) => (
              <button
                type="button"
                key={k}
                className={`ajuda-dot${k === i ? ' is-active' : ''}`}
                onClick={() => setI(k)}
                aria-label={`Ir para a imagem ${k + 1}`}
              />
            ))}
          </figcaption>
        </>
      )}
    </figure>
  );
}

// Conteúdo do tutorial, na ordem do menu. Cada seção declara os papéis que a
// veem — a página filtra pelo papel do usuário logado.
const SECTIONS: Section[] = [
  {
    id: 'inicio',
    title: 'Primeiros passos',
    icon: LifeBuoy,
    roles: ['diretor', 'coordenacao', 'professor'],
    intro: 'Como entrar e se orientar dentro do sistema.',
    steps: [
      'Acesse com o e-mail e a senha que a coordenação cadastrou para você.',
      'Use o menu lateral à esquerda para navegar entre as telas. Você só vê o que o seu perfil permite.',
      'No rodapé do menu estão o seu nome, o botão de Tema (claro/escuro) e o botão Sair.',
      'O sistema é um PWA: no celular, use "Adicionar à tela inicial" para abrir como um app.',
    ],
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    icon: LayoutDashboard,
    roles: ['diretor'],
    intro: 'A visão geral do negócio: funil, comparecimento e ocupação.',
    steps: [
      'Veja as métricas do funil de vendas, taxa de comparecimento, ocupação das aulas e alunos ativos/sem saldo.',
      'Use o filtro de unidade no topo para focar numa escola específica ou ver tudo.',
      'Os rankings e tendências ajudam a acompanhar a evolução ao longo do tempo.',
    ],
  },
  {
    id: 'vendas',
    title: 'Vendas (funil de leads)',
    icon: TrendingUp,
    roles: ['diretor', 'coordenacao'],
    intro: 'O Kanban onde cada lead caminha do primeiro contato até a matrícula.',
    steps: [
      'Cada cartão é um lead. As colunas são as etapas do funil (novo lead, em atendimento, etc.).',
      'Arraste o cartão entre as colunas para mover o lead de etapa conforme o atendimento avança.',
      'Use as abas de unidade no topo para filtrar por escola, e a busca para achar um lead pelo nome/telefone.',
      'Clique no telefone do cartão para abrir a conversa no WhatsApp.',
      'Para matricular: abra o lead e use "Converter em aluno" — o sistema gera o código de matrícula, vincula o pacote (saldo de aulas) e marca o lead como matriculado.',
    ],
  },
  {
    id: 'agenda',
    title: 'Agenda',
    icon: CalendarDays,
    roles: ['diretor', 'coordenacao'],
    intro: 'Organização das aulas por matéria.',
    steps: [
      'A agenda é organizada por matéria (as 5 disciplinas fixas); cada professor representa uma matéria.',
      'Crie e gerencie as aulas, definindo data, horário e capacidade de vagas.',
      'Os alunos são agendados nas aulas; o saldo de aulas do aluno é consumido conforme a presença.',
    ],
  },
  {
    id: 'presenca',
    title: 'Presença',
    icon: ClipboardCheck,
    roles: ['diretor', 'coordenacao', 'professor'],
    intro: 'O lançamento de presença e falta das aulas.',
    steps: [
      'Abra a aula do dia e marque cada aluno como presente ou falta.',
      'A presença confirmada consome uma aula do saldo do aluno; a regra é aplicada pelo sistema.',
      'Professores lançam a presença das próprias aulas; coordenação e direção veem tudo.',
    ],
  },
  {
    id: 'alunos',
    title: 'Alunos',
    icon: GraduationCap,
    roles: ['diretor', 'coordenacao'],
    intro: 'O cadastro e o histórico de cada aluno.',
    steps: [
      'Cadastre um aluno avulso pelo botão de novo cadastro, ou converta um lead pela tela de Vendas.',
      'Edite os dados cadastrais (nome, WhatsApp, e-mail, unidade) direto na ficha.',
      'Na aba de histórico você acompanha as aulas feitas por disciplina e os principais indicadores.',
      'Use "Renovar pacote" para adicionar saldo de aulas, e promova um aluno experimental para matriculado quando ele fechar.',
      'A busca e os filtros (unidade, tipo) ajudam a encontrar rapidamente quem você procura.',
    ],
  },
  {
    id: 'professores',
    title: 'Professores',
    icon: Presentation,
    roles: ['diretor', 'coordenacao'],
    intro: 'A gestão do corpo docente.',
    steps: [
      'Visualize os professores e a matéria que cada um representa.',
      'O histórico do professor mostra as aulas dadas e o desempenho ao longo do tempo.',
      'O cadastro de professores (com usuário de acesso) é feito na tela de Configurações.',
    ],
  },
  {
    id: 'escolas',
    title: 'Escolas (unidades)',
    icon: School,
    roles: ['diretor', 'coordenacao'],
    intro: 'O cadastro das unidades da rede.',
    steps: [
      'Cadastre e edite as unidades (nome, endereço, telefone, capacidade).',
      'Cada aluno, aula e usuário pode ser vinculado a uma unidade — isso define o que cada perfil enxerga.',
      'Desative uma unidade que não esteja mais em operação, sem perder o histórico.',
    ],
  },
  {
    id: 'configuracoes',
    title: 'Configurações',
    icon: Settings,
    roles: ['diretor'],
    intro: 'Onde a direção configura usuários, pacotes e o funil.',
    steps: [
      'Crie usuários (incluindo professores, com a matéria vinculada) e ative/desative o acesso de cada um.',
      'Gerencie os pacotes (quantidade de aulas, preço, validade) — criar, editar e desativar.',
      'Personalize as etapas do funil de vendas e as matérias do sistema.',
    ],
  },
];

const PORTAL_NOTE = {
  title: 'Portal do aluno',
  intro: 'Como o aluno acompanha as próprias aulas.',
  steps: [
    'O aluno acessa o portal informando o CPF; um link de acesso é enviado pelo WhatsApp.',
    'No portal ele vê as aulas já feitas por disciplina e as próximas, sem falar em "créditos".',
    'O portal é separado da área administrativa — o aluno nunca enxerga os dados internos.',
  ],
};

// Dúvidas frequentes — orientação prática para os tropeços mais comuns.
const FAQ: { q: string; a: string }[] = [
  {
    q: 'Fiz uma ação e apareceu um erro, mas nada foi salvo.',
    a: 'Quase sempre é a sua sessão que expirou (o acesso dura algumas horas). Recarregue a página (F5), entre de novo se pedir, e refaça a ação.',
  },
  {
    q: 'A tela ficou branca ou travada.',
    a: 'Recarregue forçando o cache: Ctrl+Shift+R (no Mac, Cmd+Shift+R). Se continuar, avise a coordenação.',
  },
  {
    q: 'No celular ou tablet não consigo arrastar os leads no funil.',
    a: 'Por enquanto, mover leads entre as etapas funciona melhor no computador. No celular, abra o lead para editá-lo.',
  },
  {
    q: 'Não consigo entrar no sistema.',
    a: 'A senha tem no mínimo 12 caracteres. Depois de várias tentativas erradas o acesso bloqueia por alguns minutos — espere e tente de novo. Esqueceu a senha? Fale com a coordenação (ainda não há recuperação automática).',
  },
  {
    q: 'Sou da coordenação e a tela aparece vazia.',
    a: 'Você enxerga apenas a sua unidade. Confira o filtro de unidade no topo; se a sua unidade ainda não tem dados, a lista fica vazia mesmo.',
  },
  {
    q: 'Não consigo matricular: diz que o CPF ou o WhatsApp já existe.',
    a: 'Já existe um aluno ativo com esse dado. Procure por ele na tela de Alunos antes de criar um novo cadastro.',
  },
  {
    q: 'O aluno não recebeu o link de acesso ao portal.',
    a: 'Confirme duas coisas: o CPF foi digitado igual ao cadastro (somente números) e o aluno tem WhatsApp cadastrado na ficha. O link vale 1 hora e é de uso único — peça um novo se já tiver expirado.',
  },
  {
    q: 'No portal, o botão de agendar aula fica "Indisponível".',
    a: 'Em geral é por: saldo de aulas esgotado, turma lotada, conflito de horário, ou a aula já começou. Verifique o saldo do aluno e o horário da turma.',
  },
  {
    q: 'Marquei presença mas não tenho certeza se salvou.',
    a: 'A presença confirmada desconta uma aula do saldo do aluno na hora. Se aparecer "aluno sem saldo", renove o pacote antes de marcar presença.',
  },
];

export function AjudaPage() {
  const auth = useAuth();
  const roles = auth.user?.roles ?? [];
  const sections = useMemo(
    () => SECTIONS.filter((s) => s.roles.some((role) => roles.includes(role))),
    [roles],
  );
  const [active, setActive] = useState(sections[0]?.id ?? 'inicio');

  return (
    <div className="app-page ajuda-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Tutorial</p>
          <h1>Como usar a Vox</h1>
        </div>
      </div>

      <p className="ajuda-lead">
        Um guia rápido de cada tela do sistema. As seções abaixo se ajustam ao seu perfil de
        acesso. Qualquer dúvida que não estiver aqui, fale com a coordenação.
      </p>

      <div className="ajuda-layout">
        <nav className="ajuda-toc" aria-label="Índice do tutorial">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={`ajuda-toc-item${active === s.id ? ' is-active' : ''}`}
                onClick={() => setActive(s.id)}
              >
                <Icon size={16} />
                {s.title}
              </a>
            );
          })}
          <a
            href="#faq"
            className={`ajuda-toc-item${active === 'faq' ? ' is-active' : ''}`}
            onClick={() => setActive('faq')}
          >
            <CircleHelp size={16} />
            Dúvidas frequentes
          </a>
        </nav>

        <div className="ajuda-content">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <section key={s.id} id={s.id} className="ajuda-section">
                <header className="ajuda-section-head">
                  <span className="ajuda-section-icon" aria-hidden>
                    <Icon size={18} />
                  </span>
                  <div>
                    <h2>{s.title}</h2>
                    <p className="ajuda-section-intro">{s.intro}</p>
                  </div>
                </header>
                <Carousel shots={SHOTS[s.id] ?? []} title={s.title} />
                <ol className="ajuda-steps">
                  {s.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </section>
            );
          })}

          <section className="ajuda-section ajuda-note">
            <header className="ajuda-section-head">
              <span className="ajuda-section-icon" aria-hidden>
                <GraduationCap size={18} />
              </span>
              <div>
                <h2>{PORTAL_NOTE.title}</h2>
                <p className="ajuda-section-intro">{PORTAL_NOTE.intro}</p>
              </div>
            </header>
            <ol className="ajuda-steps">
              {PORTAL_NOTE.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </section>

          <section id="faq" className="ajuda-section">
            <header className="ajuda-section-head">
              <span className="ajuda-section-icon" aria-hidden>
                <CircleHelp size={18} />
              </span>
              <div>
                <h2>Dúvidas frequentes</h2>
                <p className="ajuda-section-intro">O que fazer nos tropeços mais comuns.</p>
              </div>
            </header>
            <dl className="ajuda-faq">
              {FAQ.map((item, i) => (
                <div key={i} className="ajuda-faq-item">
                  <dt>{item.q}</dt>
                  <dd>{item.a}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
