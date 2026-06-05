import type React from 'react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ApiClientError, api } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import type {
  Lead,
  Package,
  StudentDetail,
  StudentHistory,
  StudentSummary,
  Unit,
} from '../api/types';
import { formatDate, formatDateTime, whatsappLink } from '../lib/format';
import { Modal } from '../components/Modal';
import { HistoryKpis, HistoryTimeline } from '../components/StudentHistoryView';
import { useToast } from '../components/ToastProvider';

type StudentForm = {
  name: string;
  whatsapp: string;
  email: string;
  type: 'matriculado' | 'experimental';
  cpf: string;
  unitId: string;
  packageId: string;
};

const EMPTY_FORM: StudentForm = {
  name: '',
  whatsapp: '',
  email: '',
  type: 'matriculado',
  cpf: '',
  unitId: '',
  packageId: '',
};

type ConvertForm = {
  type: 'matriculado' | 'experimental';
  cpf: string;
  unitId: string;
  packageId: string;
};

const EMPTY_CONVERT_FORM: ConvertForm = {
  type: 'matriculado',
  cpf: '',
  unitId: '',
  packageId: '',
};

// Marca o trecho do nome/matricula que casou com a busca atual. Insensitive,
// preserva o caso original. Devolve nodes do react pro renderer pintar o
// <mark> em cima sem disparar XSS.
function highlightMatch(text: string, query: string): React.ReactNode {
  const trimmed = query.trim();
  if (!trimmed) return text;
  const lower = text.toLowerCase();
  const needle = trimmed.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + needle.length)}</mark>
      {text.slice(idx + needle.length)}
    </>
  );
}

type EditStudentForm = {
  name: string;
  whatsapp: string;
  email: string;
  unitId: string;
};

const EMPTY_EDIT_FORM: EditStudentForm = { name: '', whatsapp: '', email: '', unitId: '' };

export function AlunosPage() {
  const auth = useAuth();
  const canCreate = (auth.user?.roles ?? []).some((role) => role === 'diretor');
  // Diretor e coordenacao operam o aluno: renovar pacote, editar cadastro e
  // converter leads do pipeline. O cadastro avulso e so do diretor (canCreate).
  const canOperate = (auth.user?.roles ?? []).some(
    (role) => role === 'diretor' || role === 'coordenacao',
  );

  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selected, setSelected] = useState<StudentDetail>();

  // Filtros da listagem. Aplicados client-side em cima de `students` ja
  // carregados — a base inteira fica em memoria (algumas centenas de alunos).
  // Se a base crescer muito, mover pra query do servidor (?search/?unit/?type).
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<'todos' | 'matriculado' | 'experimental'>('todos');
  // Faixas de saldo restante (creditBalance) e ordenacao da lista.
  const [saldoFilter, setSaldoFilter] = useState<'todos' | 'sem' | 'baixo' | 'medio' | 'alto'>(
    'todos',
  );
  const [sortOrder, setSortOrder] = useState<'nome' | 'saldo_desc' | 'saldo_asc'>('nome');

  const visibleStudents = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = students.filter((student) => {
      if (typeFilter !== 'todos' && student.type !== typeFilter) return false;
      if (unitFilter && student.unitId !== unitFilter) return false;
      if (saldoFilter !== 'todos') {
        const saldo = student.creditBalance;
        if (saldoFilter === 'sem' && saldo !== 0) return false;
        if (saldoFilter === 'baixo' && !(saldo >= 1 && saldo <= 4)) return false;
        if (saldoFilter === 'medio' && !(saldo >= 5 && saldo <= 9)) return false;
        if (saldoFilter === 'alto' && saldo < 10) return false;
      }
      if (query) {
        const haystack = `${student.name} ${student.enrollmentCode}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    // Ordenacao (nao muta o array original).
    const sorted = [...filtered];
    if (sortOrder === 'saldo_desc') sorted.sort((a, b) => b.creditBalance - a.creditBalance);
    else if (sortOrder === 'saldo_asc') sorted.sort((a, b) => a.creditBalance - b.creditBalance);
    else sorted.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return sorted;
  }, [students, search, unitFilter, typeFilter, saldoFilter, sortOrder]);

  // Paginacao client-side: 20 por pagina. Volta pra pagina 1 quando os
  // filtros/busca mudam; `currentPage` fica preso ao total de paginas.
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [search, unitFilter, typeFilter, saldoFilter, sortOrder]);
  const pageCount = Math.max(1, Math.ceil(visibleStudents.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedStudents = visibleStudents.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const [form, setForm] = useState<StudentForm>(EMPTY_FORM);
  const [renewPackageId, setRenewPackageId] = useState('');
  const [renewSaving, setRenewSaving] = useState(false);
  const [adjustingRowId, setAdjustingRowId] = useState<string>();
  const [enrollForm, setEnrollForm] = useState<{ packageId: string; cpf: string }>({
    packageId: '',
    cpf: '',
  });
  const [enrollSaving, setEnrollSaving] = useState(false);
  const [editForm, setEditForm] = useState<EditStudentForm>(EMPTY_EDIT_FORM);
  const [editSaving, setEditSaving] = useState(false);
  const [leadSearch, setLeadSearch] = useState('');
  const [leadResults, setLeadResults] = useState<Lead[]>([]);
  const [leadSearching, setLeadSearching] = useState(false);
  const [convertLead, setConvertLead] = useState<Lead>();
  const [convertForm, setConvertForm] = useState<ConvertForm>(EMPTY_CONVERT_FORM);
  const [convertSaving, setConvertSaving] = useState(false);
  const [linkPendingId, setLinkPendingId] = useState<string>();
  const [activeTab, setActiveTab] = useState<'cadastro' | 'historico'>('cadastro');
  const [history, setHistory] = useState<StudentHistory>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const toast = useToast();
  // setError/setInfo encaminham para o sistema de toasts (mensagem vazia = no-op).
  const setError = (message: string) => {
    if (message) toast.error(message);
  };
  const setInfo = (message: string) => {
    if (message) toast.success(message);
  };
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  // Tokens dos links publicos de auto-cadastro (so a equipe ve, para copiar).
  const [signupLinks, setSignupLinks] = useState<{
    matriculado: string | null;
    experimental: string | null;
  }>();
  const [showLinks, setShowLinks] = useState(false);

  const load = useCallback(async () => {
    try {
      // Pacotes e unidades sao usados tanto pelo cadastro (so diretor)
      // quanto pela renovacao (diretor + coordenacao) — entao carrega sempre.
      const [studentList, packageList, unitList] = await Promise.all([
        api<{ data: StudentSummary[] }>('/api/students'),
        api<{ data: Package[] }>('/api/packages'),
        api<{ data: Unit[] }>('/api/units'),
      ]);
      setStudents(studentList.data);
      setPackages(packageList.data.filter((item) => item.active));
      setUnits(unitList.data.filter((item) => item.active));
    } catch {
      setError('Nao foi possivel carregar os alunos.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Carrega os tokens dos links publicos de cadastro (diretor/coordenacao).
  useEffect(() => {
    if (!canOperate) return;
    api<{ data: { matriculado: string | null; experimental: string | null } }>(
      '/api/public/signup-links',
    )
      .then((response) => setSignupLinks(response.data))
      .catch(() => setSignupLinks(undefined));
  }, [canOperate]);

  async function copyUrl(url: string, label: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`Link ${label} copiado!`);
    } catch {
      toast.error('Nao foi possivel copiar: ' + url);
    }
  }

  // Links de cadastro de ALUNO (os de equipe ficam em Configuracoes).
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const cadastroLinks = [
    { label: 'Aluno', url: `${origin}/cadastro-alunos` },
    ...(signupLinks?.matriculado
      ? [{ label: 'Aluno matriculado (token)', url: `${origin}/cadastro/${signupLinks.matriculado}` }]
      : []),
    ...(signupLinks?.experimental
      ? [
          {
            label: 'Aluno experimental (token)',
            url: `${origin}/cadastro/${signupLinks.experimental}`,
          },
        ]
      : []),
  ];

  // Busca de leads no pipeline com debounce de 300ms. Leads ja matriculados
  // saem da lista — nao podem ser convertidos de novo.
  useEffect(() => {
    const term = leadSearch.trim();
    if (term.length < 2) {
      setLeadResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setLeadSearching(true);
      try {
        const params = new URLSearchParams({ search: term, pageSize: '20' });
        const response = await api<{ data: Lead[] }>(`/api/leads?${params.toString()}`);
        if (active) {
          setLeadResults(response.data.filter((lead) => lead.stage !== 'matriculado'));
        }
      } catch {
        if (active) setLeadResults([]);
      } finally {
        if (active) setLeadSearching(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [leadSearch]);

  function updateField(field: keyof StudentForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateEditField(field: keyof EditStudentForm, value: string) {
    setEditForm((current) => ({ ...current, [field]: value }));
  }

  /**
   * Gera um link magico de acesso ao portal e copia pro clipboard — a equipe
   * repassa ao aluno por qualquer canal. O link e de uso unico e expira.
   */
  async function handleGenerateLink(studentId: string) {
    setLinkPendingId(studentId);
    setError('');
    setInfo('');
    try {
      const response = await api<{ data: { link: string; expiresInMinutes: number } }>(
        `/api/students/${studentId}/magic-link`,
        { method: 'POST' },
      );
      const { link, expiresInMinutes } = response.data;
      try {
        await navigator.clipboard.writeText(link);
        setInfo(`Link copiado (valido ${expiresInMinutes} min): ${link}`);
      } catch {
        // Clipboard pode falhar (permissao/contexto) — mostra pra copiar manual.
        setInfo(`Link de acesso (valido ${expiresInMinutes} min): ${link}`);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Nao foi possivel gerar o link.');
    } finally {
      setLinkPendingId(undefined);
    }
  }

  async function openStudent(id: string) {
    setLoadingDetail(true);
    setError('');
    setActiveTab('cadastro');
    setHistory(undefined);
    try {
      const response = await api<{ data: StudentDetail }>(`/api/students/${id}`);
      setSelected(response.data);
      setRenewPackageId('');
      // WhatsApp vem mascarado da API — o campo comeca vazio e so e enviado
      // se a equipe digitar um numero novo.
      setEditForm({
        name: response.data.name,
        whatsapp: '',
        email: response.data.email ?? '',
        unitId: response.data.unitId ?? '',
      });
    } catch {
      setError('Nao foi possivel abrir o aluno.');
    } finally {
      setLoadingDetail(false);
    }
  }

  // Historico do aluno carrega sob demanda quando a aba e acessada — evita
  // request extra pra quem so vai operar cadastro/renovacao.
  async function loadHistory(studentId: string, since?: string) {
    setHistoryLoading(true);
    try {
      const path = since
        ? `/api/students/${studentId}/history?since=${encodeURIComponent(since)}`
        : `/api/students/${studentId}/history`;
      const response = await api<{ data: StudentHistory }>(path);
      setHistory(response.data);
    } catch {
      setError('Nao foi possivel carregar o historico.');
    } finally {
      setHistoryLoading(false);
    }
  }

  function openHistoryTab() {
    setActiveTab('historico');
    if (selected && !history && !historyLoading) {
      void loadHistory(selected.id);
    }
  }

  // Ver mais: amplia a janela em +90 dias a partir do `since` atual.
  function loadOlderHistory() {
    if (!selected || !history) return;
    const currentSince = new Date(history.since);
    const olderSince = new Date(currentSince.getTime() - 90 * 24 * 60 * 60 * 1000);
    void loadHistory(selected.id, olderSince.toISOString());
  }

  function updateEnrollField(field: keyof typeof enrollForm, value: string) {
    setEnrollForm((current) => ({ ...current, [field]: value }));
  }

  async function handleEnroll(event: FormEvent) {
    event.preventDefault();
    if (!selected || !enrollForm.packageId) return;
    setEnrollSaving(true);

    const body: Record<string, string> = { packageId: enrollForm.packageId };
    if (enrollForm.cpf.trim()) body.cpf = enrollForm.cpf.trim();

    try {
      const response = await api<{
        data: { name: string; enrollmentCode: string; packageName: string | null };
      }>(`/api/students/${selected.id}/enroll`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      toast.success(
        `${response.data.name} matriculado em ${response.data.packageName ?? 'pacote'}. Matricula ${response.data.enrollmentCode}.`,
      );
      setEnrollForm({ packageId: '', cpf: '' });
      await openStudent(selected.id);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel matricular o aluno.',
      );
    } finally {
      setEnrollSaving(false);
    }
  }

  async function handleRenew(event: FormEvent) {
    event.preventDefault();
    if (!selected || !renewPackageId) return;
    setError('');
    setInfo('');
    setRenewSaving(true);

    try {
      const response = await api<{
        data: { packageName: string; creditBalance: number; name: string };
      }>(`/api/students/${selected.id}/renew`, {
        method: 'POST',
        body: JSON.stringify({ packageId: renewPackageId }),
      });
      setInfo(
        `${response.data.name}: renovado com ${response.data.packageName}. Saldo agora ${response.data.creditBalance} aulas.`,
      );
      setRenewPackageId('');
      await openStudent(selected.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Nao foi possivel renovar o pacote.');
    } finally {
      setRenewSaving(false);
    }
  }

  // Ajuste de saldo (+/- 1) direto na coluna da tabela. Atualiza so a linha.
  async function handleRowAdjust(studentId: string, sign: 1 | -1) {
    setAdjustingRowId(studentId);
    try {
      const response = await api<{ data: { creditBalance: number } }>(
        `/api/students/${studentId}/credits`,
        { method: 'PATCH', body: JSON.stringify({ delta: sign }) },
      );
      setStudents((list) =>
        list.map((item) =>
          item.id === studentId ? { ...item, creditBalance: response.data.creditBalance } : item,
        ),
      );
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Nao foi possivel ajustar o saldo.',
      );
    } finally {
      setAdjustingRowId(undefined);
    }
  }

  async function handleEditStudent(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setError('');
    setInfo('');
    setEditSaving(true);

    try {
      // Nome e e-mail vao sempre (e-mail vazio limpa o campo); WhatsApp e
      // unidade so quando preenchidos — WhatsApp em branco mantem o atual.
      const body: Record<string, string> = {
        name: editForm.name,
        email: editForm.email,
      };
      const whatsapp = editForm.whatsapp.trim();
      if (whatsapp) body.whatsapp = whatsapp;
      if (editForm.unitId) body.unitId = editForm.unitId;

      const response = await api<{ data: { name: string } }>(`/api/students/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setInfo(`${response.data.name}: dados atualizados.`);
      await openStudent(selected.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Nao foi possivel salvar o aluno.');
    } finally {
      setEditSaving(false);
    }
  }

  function selectLead(lead: Lead) {
    setConvertLead(lead);
    setError('');
    setInfo('');
    // Tenta casar a unidade de interesse do lead (texto livre) com uma real.
    const matchedUnit = units.find((unit) => unit.name === lead.unitInterest);
    setConvertForm({
      type: 'matriculado',
      cpf: '',
      unitId: matchedUnit?.id ?? '',
      packageId: '',
    });
  }

  /**
   * Converte o lead selecionado em aluno reusando POST /leads/:id/convert —
   * o mesmo fluxo da pagina de Vendas. Mantem o vinculo lead->aluno (origem)
   * e move o lead para "matriculado".
   */
  async function handleConvertLead(event: FormEvent) {
    event.preventDefault();
    if (!convertLead) return;
    setError('');
    setInfo('');
    setConvertSaving(true);

    try {
      const body: Record<string, string> = {
        type: convertForm.type,
        unitId: convertForm.unitId,
      };
      if (convertForm.cpf) body.cpf = convertForm.cpf;
      // Pacote so vai no corpo quando matriculando — experimental nao paga.
      if (convertForm.type === 'matriculado' && convertForm.packageId) {
        body.packageId = convertForm.packageId;
      }
      const response = await api<{
        data: {
          student: {
            name: string;
            enrollmentCode: string;
            packageName: string | null;
            type: 'matriculado' | 'experimental';
          };
        };
      }>(`/api/leads/${convertLead.id}/convert`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const { name, enrollmentCode, packageName, type } = response.data.student;
      setInfo(
        type === 'matriculado'
          ? `${name} matriculado a partir do lead. Matricula ${enrollmentCode} - ${packageName}.`
          : `${name} virou aluno experimental. Matricula ${enrollmentCode}.`,
      );
      setConvertLead(undefined);
      setShowConvert(false);
      setConvertForm(EMPTY_CONVERT_FORM);
      setLeadSearch('');
      setLeadResults([]);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Nao foi possivel converter o lead.');
    } finally {
      setConvertSaving(false);
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError('');
    setInfo('');
    setSaving(true);

    try {
      // CPF agora e opcional em qualquer tipo — so manda se foi preenchido.
      // Experimental: tambem nao precisa de packageId.
      const body: Record<string, string> = {
        name: form.name,
        whatsapp: form.whatsapp,
        type: form.type,
        unitId: form.unitId,
      };
      if (form.email) body.email = form.email;
      if (form.cpf.trim()) body.cpf = form.cpf.trim();
      if (form.type === 'matriculado' && form.packageId) {
        body.packageId = form.packageId;
      }
      const response = await api<{
        data: { name: string; enrollmentCode: string; type: 'matriculado' | 'experimental' };
      }>('/api/students', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const label = response.data.type === 'matriculado' ? 'cadastrado' : 'cadastrado (experimental)';
      setInfo(`${response.data.name} ${label}. Matricula ${response.data.enrollmentCode}.`);
      setForm(EMPTY_FORM);
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Nao foi possivel cadastrar o aluno.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="app-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Alunos</p>
          <h1>Perfil do aluno</h1>
        </div>
        <div className="row-actions">
          {canOperate && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => setShowLinks(true)}
              title="Links publicos de cadastro para copiar e enviar"
            >
              Links de cadastro
            </button>
          )}
          {canOperate && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => setShowConvert(true)}
            >
              Converter lead
            </button>
          )}
          {canCreate && (
            <button type="button" onClick={() => setShowCreate(true)}>
              Cadastrar aluno
            </button>
          )}
        </div>
      </header>

      {showLinks && (
        <Modal title="Links de cadastro" onClose={() => setShowLinks(false)}>
          <p className="muted-text">
            Copie e envie o link do tipo desejado. A pessoa preenche o proprio cadastro.
          </p>
          <ul className="signup-links">
            {cadastroLinks.map((link) => (
              <li key={link.url}>
                <div>
                  <strong>{link.label}</strong>
                  <span className="muted-text">{link.url}</span>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void copyUrl(link.url, link.label)}
                >
                  Copiar
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {canCreate && showCreate && (
        <Modal title="Novo aluno" onClose={() => setShowCreate(false)}>
          <p className="muted-text">
            {form.type === 'matriculado'
              ? 'Cadastro avulso (sem lead). O saldo de aulas vem da quantidade do pacote.'
              : 'Aluno experimental: sem pacote, sem CPF obrigatorio — para agendar aula trial.'}
          </p>
          <form className="grid-form" onSubmit={handleCreate}>
            <label>
              Tipo
              <select
                value={form.type}
                onChange={(event) =>
                  updateField('type', event.target.value as StudentForm['type'])
                }
                required
              >
                <option value="matriculado">Matriculado</option>
                <option value="experimental">Experimental</option>
              </select>
            </label>
            <label>
              Nome
              <input
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                required
              />
            </label>
            <label>
              WhatsApp
              <input
                value={form.whatsapp}
                onChange={(event) => updateField('whatsapp', event.target.value)}
                required
              />
            </label>
            <label>
              E-mail
              <input
                type="email"
                value={form.email}
                onChange={(event) => updateField('email', event.target.value)}
              />
            </label>
            <label>
              CPF (opcional)
              <input
                value={form.cpf}
                onChange={(event) => updateField('cpf', event.target.value)}
                inputMode="numeric"
              />
            </label>
            <label>
              Unidade
              <select
                value={form.unitId}
                onChange={(event) => updateField('unitId', event.target.value)}
                required
              >
                <option value="">Selecione</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            {form.type === 'matriculado' && (
              <label>
                Pacote
                <select
                  value={form.packageId}
                  onChange={(event) => updateField('packageId', event.target.value)}
                  required
                >
                  <option value="">Selecione</option>
                  {packages.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.classCount} aulas)
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="grid-form-actions">
              <button type="submit" disabled={saving}>
                {saving ? 'Salvando...' : 'Cadastrar aluno'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {canOperate && showConvert && (
        <Modal title="Converter lead em aluno" onClose={() => setShowConvert(false)}>
          <p className="muted-text">
            Busca um contato do pipeline de Vendas. Matriculado: vende pacote e o lead
            sai do funil. Experimental: cria o aluno com CPF mas sem pacote — o lead
            vai para "experimental_agendada".
          </p>
          <label>
            Buscar lead
            <input
              value={leadSearch}
              onChange={(event) => setLeadSearch(event.target.value)}
              placeholder="Nome, WhatsApp ou campanha"
            />
          </label>

          {leadSearch.trim().length >= 2 && !convertLead && (
            <div className="stack">
              {leadSearching && <p className="muted-text">Buscando...</p>}
              {!leadSearching && leadResults.length === 0 && (
                <p className="muted-text">Nenhum lead disponivel para conversao.</p>
              )}
              {leadResults.map((lead) => (
                <button
                  type="button"
                  key={lead.id}
                  className="secondary-button"
                  onClick={() => selectLead(lead)}
                >
                  {lead.name} - {lead.whatsapp ?? 'sem WhatsApp'} - {lead.unitInterest}
                  {lead.campaign ? ` - ${lead.campaign}` : ''}
                </button>
              ))}
            </div>
          )}

          {convertLead && (
            <div className="stack">
              <p className="muted-text">
                Convertendo <strong>{convertLead.name}</strong> ({convertLead.whatsapp ?? 'sem WhatsApp'}).
              </p>
              <form className="grid-form" onSubmit={handleConvertLead}>
                <label>
                  Tipo
                  <select
                    value={convertForm.type}
                    onChange={(event) =>
                      setConvertForm((current) => ({
                        ...current,
                        type: event.target.value as ConvertForm['type'],
                      }))
                    }
                    required
                  >
                    <option value="matriculado">Matriculado</option>
                    <option value="experimental">Experimental</option>
                  </select>
                </label>
                <label>
                  CPF (opcional)
                  <input
                    value={convertForm.cpf}
                    onChange={(event) =>
                      setConvertForm((current) => ({ ...current, cpf: event.target.value }))
                    }
                    inputMode="numeric"
                  />
                </label>
                <label>
                  Unidade
                  <select
                    value={convertForm.unitId}
                    onChange={(event) =>
                      setConvertForm((current) => ({ ...current, unitId: event.target.value }))
                    }
                    required
                  >
                    <option value="">Selecione</option>
                    {units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </select>
                </label>
                {convertForm.type === 'matriculado' && (
                  <label>
                    Pacote
                    <select
                      value={convertForm.packageId}
                      onChange={(event) =>
                        setConvertForm((current) => ({ ...current, packageId: event.target.value }))
                      }
                      required
                    >
                      <option value="">Selecione</option>
                      {packages.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.classCount} aulas)
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="grid-form-actions">
                  <button type="submit" disabled={convertSaving}>
                    {convertSaving
                      ? 'Convertendo...'
                      : convertForm.type === 'matriculado'
                        ? 'Matricular aluno'
                        : 'Cadastrar como experimental'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setConvertLead(undefined)}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          )}
        </Modal>
      )}

      <div className="filter-bar" role="search">
        <label className="filter-bar-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Buscar aluno por nome ou matricula"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Buscar aluno"
          />
        </label>
        <select
          className="filter-bar-select"
          value={unitFilter}
          onChange={(event) => setUnitFilter(event.target.value)}
          aria-label="Filtrar por escola"
        >
          <option value="">Todas as escolas</option>
          {units
            .filter((unit) => unit.active)
            .map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
        </select>
        <select
          className="filter-bar-select"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}
          aria-label="Filtrar por tipo"
        >
          <option value="todos">Todos os tipos</option>
          <option value="matriculado">Matriculado</option>
          <option value="experimental">Experimental</option>
        </select>
        <select
          className="filter-bar-select"
          value={saldoFilter}
          onChange={(event) => setSaldoFilter(event.target.value as typeof saldoFilter)}
          aria-label="Filtrar por saldo restante"
        >
          <option value="todos">Todos os saldos</option>
          <option value="sem">Sem saldo (0)</option>
          <option value="baixo">Saldo baixo (1–4)</option>
          <option value="medio">Saldo medio (5–9)</option>
          <option value="alto">Saldo alto (10+)</option>
        </select>
        <select
          className="filter-bar-select"
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)}
          aria-label="Ordenar lista"
        >
          <option value="nome">Ordem: Nome (A–Z)</option>
          <option value="saldo_desc">Saldo: maior → menor</option>
          <option value="saldo_asc">Saldo: menor → maior</option>
        </select>
        <span className="filter-bar-count">
          {visibleStudents.length === students.length
            ? `${students.length} alunos`
            : `${visibleStudents.length} de ${students.length}`}
        </span>
      </div>

      <div className={selected ? 'split-grid' : 'split-grid split-grid-collapsed'}>
        <section className="table-card">
          <table className="cards-table">
            <thead>
              <tr>
                <th>Aluno</th>
                <th>Tipo</th>
                <th>Matricula</th>
                <th>Escola</th>
                <th>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {visibleStudents.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    {students.length === 0
                      ? 'Nenhum aluno cadastrado.'
                      : 'Nenhum aluno encontrado com esses filtros.'}
                  </td>
                </tr>
              )}
              {pagedStudents.map((student) => (
                <tr
                  key={student.id}
                  className={selected?.id === student.id ? 'row-selected' : undefined}
                  onClick={() => void openStudent(student.id)}
                >
                  <td data-label="Aluno">{highlightMatch(student.name, search)}</td>
                  <td data-label="Tipo">
                    <span className="status-chip">
                      {student.type === 'experimental' ? 'Experimental' : 'Matriculado'}
                    </span>
                  </td>
                  <td data-label="Matricula">{highlightMatch(student.enrollmentCode, search)}</td>
                  <td data-label="Escola">{student.unitName ?? '-'}</td>
                  <td data-label="Saldo">
                    <div className="saldo-cell">
                      {canOperate && (
                        <button
                          type="button"
                          className="saldo-btn"
                          aria-label="Subtrair 1 aula"
                          disabled={adjustingRowId === student.id || student.creditBalance <= 0}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleRowAdjust(student.id, -1);
                          }}
                        >
                          −
                        </button>
                      )}
                      <span className="saldo-value">{student.creditBalance}</span>
                      {canOperate && (
                        <button
                          type="button"
                          className="saldo-btn"
                          aria-label="Adicionar 1 aula"
                          disabled={adjustingRowId === student.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleRowAdjust(student.id, 1);
                          }}
                        >
                          +
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pageCount > 1 && (
            <div className="pagination">
              <button
                type="button"
                className="secondary-button"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Anterior
              </button>
              <span className="muted-text">
                Pagina {currentPage} de {pageCount}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={currentPage >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Proxima →
              </button>
            </div>
          )}
        </section>

        <aside className="detail-card">
          {!selected && !loadingDetail && (
            <p className="muted-text">Selecione um aluno para ver o historico.</p>
          )}
          {loadingDetail && <p className="muted-text">Carregando aluno...</p>}
          {selected && !loadingDetail && (
            <div className="stack">
              <div>
                <p className="eyebrow">{selected.enrollmentCode}</p>
                <h2>{selected.name}</h2>
                <span className="status-chip">
                  {selected.type === 'experimental' ? 'Experimental' : 'Matriculado'}
                </span>
                {selected.tags.length > 0 && (
                  <div className="tag-chip-row" aria-label="Tags do aluno">
                    {selected.tags.map((tag) => (
                      <span key={tag} className="tag-chip">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <p className="muted-text">
                  {selected.type === 'experimental'
                    ? `${selected.unitName ?? 'Sem unidade'} - Aluno experimental (sem pacote)`
                    : `${selected.unitName ?? 'Sem unidade'} - ${selected.packageName} - ${selected.creditBalance} aulas restantes`}
                </p>
                <p className="muted-text">
                  {/* Numero abre o WhatsApp (wa.me), igual aos cards do CRM. */}
                  WhatsApp{' '}
                  {selected.whatsapp ? (
                    (() => {
                      const waLink = whatsappLink(selected.whatsapp);
                      return waLink ? (
                        <a
                          className="text-link"
                          href={waLink}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {selected.whatsapp}
                        </a>
                      ) : (
                        selected.whatsapp
                      );
                    })()
                  ) : (
                    'nao cadastrado'
                  )}
                  {selected.cpf ? ` - CPF ${selected.cpf}` : ''}
                  {selected.email ? ` - ${selected.email}` : ''}
                </p>
                {selected.origin && (
                  <p className="muted-text">
                    Origem: {selected.origin.campaign ?? selected.origin.source}
                  </p>
                )}
                {/* Magic link de acesso ao portal — so faz sentido pra
                    aluno matriculado (experimental nao tem portal). */}
                {selected.type === 'matriculado' && (
                  <div className="row-actions detail-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={linkPendingId === selected.id}
                      onClick={() => void handleGenerateLink(selected.id)}
                    >
                      {linkPendingId === selected.id ? 'Gerando...' : 'Gerar link de acesso'}
                    </button>
                  </div>
                )}
              </div>

              <nav className="detail-tabs" aria-label="Secoes do aluno">
                <button
                  type="button"
                  className={activeTab === 'cadastro' ? 'is-active' : ''}
                  onClick={() => setActiveTab('cadastro')}
                >
                  Cadastro
                </button>
                <button
                  type="button"
                  className={activeTab === 'historico' ? 'is-active' : ''}
                  onClick={openHistoryTab}
                >
                  Historico
                </button>
              </nav>

              {activeTab === 'historico' && (
                <div className="stack">
                  {historyLoading && !history && (
                    <p className="muted-text">Carregando historico...</p>
                  )}
                  {history && (
                    <>
                      <HistoryKpis history={history} />
                      <HistoryTimeline events={history.timeline} />
                      <div className="grid-form-actions">
                        <button
                          type="button"
                          onClick={loadOlderHistory}
                          disabled={historyLoading}
                        >
                          {historyLoading ? 'Carregando...' : 'Ver mais (+90 dias)'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'cadastro' && canOperate && (
                <div>
                  <h3>Editar dados</h3>
                  <p className="muted-text">
                    Nome, WhatsApp, e-mail e unidade. O CPF nao e editavel.
                  </p>
                  <form className="grid-form" onSubmit={handleEditStudent}>
                    <label>
                      Nome
                      <input
                        value={editForm.name}
                        onChange={(event) => updateEditField('name', event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      WhatsApp
                      <input
                        value={editForm.whatsapp}
                        onChange={(event) => updateEditField('whatsapp', event.target.value)}
                        placeholder={
                          selected.whatsapp
                            ? `Atual: ${selected.whatsapp} - preencha so para trocar`
                            : 'Sem WhatsApp - preencha para cadastrar'
                        }
                      />
                    </label>
                    <label>
                      E-mail
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={(event) => updateEditField('email', event.target.value)}
                      />
                    </label>
                    <label>
                      Unidade
                      <select
                        value={editForm.unitId}
                        onChange={(event) => updateEditField('unitId', event.target.value)}
                        required
                      >
                        <option value="">Selecione</option>
                        {units.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid-form-actions">
                      <button type="submit" disabled={editSaving}>
                        {editSaving ? 'Salvando...' : 'Salvar alteracoes'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {activeTab === 'cadastro' && canOperate && selected.type === 'experimental' && (
                <div>
                  <h3>Matricular aluno</h3>
                  <p className="muted-text">
                    Promove esse aluno experimental para matriculado. O saldo de
                    aulas vem do pacote escolhido. CPF e opcional — preencha
                    quando coletar.
                  </p>
                  <form className="grid-form" onSubmit={handleEnroll}>
                    <label>
                      Pacote
                      <select
                        value={enrollForm.packageId}
                        onChange={(event) => updateEnrollField('packageId', event.target.value)}
                        required
                      >
                        <option value="">Selecione</option>
                        {packages.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} (+{item.classCount} aulas)
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      CPF (opcional)
                      <input
                        value={enrollForm.cpf}
                        onChange={(event) => updateEnrollField('cpf', event.target.value)}
                        inputMode="numeric"
                        placeholder="000.000.000-00"
                      />
                    </label>
                    <div className="grid-form-actions">
                      <button type="submit" disabled={enrollSaving || !enrollForm.packageId}>
                        {enrollSaving ? 'Matriculando...' : 'Matricular aluno'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {activeTab === 'cadastro' && canOperate && selected.type === 'matriculado' && (
                <div>
                  <h3>Renovar pacote</h3>
                  <p className="muted-text">
                    Vende um novo pacote pro aluno; soma {' '}
                    <em>aulas do pacote</em> ao saldo atual e atualiza o pacote ativo.
                    Pagamento e auditoria externos.
                  </p>
                  <form className="grid-form" onSubmit={handleRenew}>
                    <label>
                      Pacote
                      <select
                        value={renewPackageId}
                        onChange={(event) => setRenewPackageId(event.target.value)}
                        required
                      >
                        <option value="">Selecione</option>
                        {packages.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} (+{item.classCount} aulas)
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid-form-actions">
                      <button type="submit" disabled={renewSaving || !renewPackageId}>
                        {renewSaving ? 'Renovando...' : 'Confirmar renovacao'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {activeTab === 'cadastro' && (
                <>
                  <div>
                    <h3>Agendamentos</h3>
                    {selected.bookings.length === 0 && (
                      <p className="muted-text">Nenhum agendamento.</p>
                    )}
                    <ul className="history-list">
                      {selected.bookings.map((booking) => (
                        <li key={booking.id}>
                          <span>{booking.classLabel}</span>
                          <span>
                            {formatDateTime(booking.startsAt)} - {booking.type} - {booking.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h3>Presencas</h3>
                    {selected.attendances.length === 0 && (
                      <p className="muted-text">Nenhuma presenca registrada.</p>
                    )}
                    <ul className="history-list">
                      {selected.attendances.map((attendance) => (
                        <li key={attendance.id}>
                          <span>{attendance.classLabel}</span>
                          <span>
                            {formatDate(attendance.startsAt)} - {attendance.status}
                            {attendance.creditConsumed ? ' - credito consumido' : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
