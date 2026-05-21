import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiClientError, api } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import type { Lead, Package, StudentDetail, StudentSummary, Unit } from '../api/types';
import { formatDate, formatDateTime } from '../lib/format';
import { useToast } from '../components/ToastProvider';

type StudentForm = {
  name: string;
  whatsapp: string;
  email: string;
  cpf: string;
  unitId: string;
  packageId: string;
};

const EMPTY_FORM: StudentForm = {
  name: '',
  whatsapp: '',
  email: '',
  cpf: '',
  unitId: '',
  packageId: '',
};

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
  const [form, setForm] = useState<StudentForm>(EMPTY_FORM);
  const [renewPackageId, setRenewPackageId] = useState('');
  const [renewSaving, setRenewSaving] = useState(false);
  const [editForm, setEditForm] = useState<EditStudentForm>(EMPTY_EDIT_FORM);
  const [editSaving, setEditSaving] = useState(false);
  const [leadSearch, setLeadSearch] = useState('');
  const [leadResults, setLeadResults] = useState<Lead[]>([]);
  const [leadSearching, setLeadSearching] = useState(false);
  const [convertLead, setConvertLead] = useState<Lead>();
  const [convertForm, setConvertForm] = useState({ cpf: '', unitId: '', packageId: '' });
  const [convertSaving, setConvertSaving] = useState(false);
  const [linkPendingId, setLinkPendingId] = useState<string>();
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
    setConvertForm({ cpf: '', unitId: matchedUnit?.id ?? '', packageId: '' });
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
      const response = await api<{
        data: { student: { name: string; enrollmentCode: string; packageName: string } };
      }>(`/api/leads/${convertLead.id}/convert`, {
        method: 'POST',
        body: JSON.stringify({
          cpf: convertForm.cpf,
          unitId: convertForm.unitId,
          packageId: convertForm.packageId,
        }),
      });
      const { name, enrollmentCode, packageName } = response.data.student;
      setInfo(`${name} matriculado a partir do lead. Matricula ${enrollmentCode} - ${packageName}.`);
      setConvertLead(undefined);
      setConvertForm({ cpf: '', unitId: '', packageId: '' });
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
      const response = await api<{ data: { name: string; enrollmentCode: string } }>(
        '/api/students',
        {
          method: 'POST',
          body: JSON.stringify({
            name: form.name,
            whatsapp: form.whatsapp,
            email: form.email || undefined,
            cpf: form.cpf,
            unitId: form.unitId,
            packageId: form.packageId,
          }),
        },
      );
      setInfo(`${response.data.name} cadastrado. Matricula ${response.data.enrollmentCode}.`);
      setForm(EMPTY_FORM);
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
      </header>

      {canCreate && (
        <section className="form-card">
          <h2>Novo aluno</h2>
          <p className="muted-text">
            Cadastro avulso (sem lead). O saldo de aulas vem da quantidade do pacote.
          </p>
          <form className="grid-form" onSubmit={handleCreate}>
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
              CPF
              <input
                value={form.cpf}
                onChange={(event) => updateField('cpf', event.target.value)}
                inputMode="numeric"
                required
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
            <div className="grid-form-actions">
              <button type="submit" disabled={saving}>
                {saving ? 'Salvando...' : 'Cadastrar aluno'}
              </button>
            </div>
          </form>
        </section>
      )}

      {canOperate && (
        <section className="form-card">
          <h2>Converter lead em aluno</h2>
          <p className="muted-text">
            Busca um contato do pipeline de Vendas e matricula. Mantem o vinculo com o
            lead (origem/campanha) e move ele para "matriculado".
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
                  {lead.name} - {lead.whatsapp} - {lead.unitInterest}
                  {lead.campaign ? ` - ${lead.campaign}` : ''}
                </button>
              ))}
            </div>
          )}

          {convertLead && (
            <div className="stack">
              <p className="muted-text">
                Convertendo <strong>{convertLead.name}</strong> ({convertLead.whatsapp}).
              </p>
              <form className="grid-form" onSubmit={handleConvertLead}>
                <label>
                  CPF
                  <input
                    value={convertForm.cpf}
                    onChange={(event) =>
                      setConvertForm((current) => ({ ...current, cpf: event.target.value }))
                    }
                    inputMode="numeric"
                    required
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
                <div className="grid-form-actions">
                  <button type="submit" disabled={convertSaving}>
                    {convertSaving ? 'Convertendo...' : 'Converter em aluno'}
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
        </section>
      )}

      <div className="split-grid">
        <section className="table-card">
          <table>
            <thead>
              <tr>
                <th>Aluno</th>
                <th>Matricula</th>
                <th>Unidade</th>
                <th>Saldo</th>
                <th>Acesso</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 && (
                <tr>
                  <td colSpan={5}>Nenhum aluno cadastrado.</td>
                </tr>
              )}
              {students.map((student) => (
                <tr
                  key={student.id}
                  className={selected?.id === student.id ? 'row-selected' : undefined}
                  onClick={() => void openStudent(student.id)}
                >
                  <td>{student.name}</td>
                  <td>{student.enrollmentCode}</td>
                  <td>{student.unitName ?? '-'}</td>
                  <td>{student.creditBalance}</td>
                  <td>
                    {/* stopPropagation: o clique gera o link sem abrir o detalhe. */}
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={linkPendingId === student.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleGenerateLink(student.id);
                      }}
                    >
                      {linkPendingId === student.id ? 'Gerando...' : 'Gerar link'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                <p className="muted-text">
                  {selected.unitName ?? 'Sem unidade'} - {selected.packageName} -{' '}
                  {selected.creditBalance} aulas restantes
                </p>
                <p className="muted-text">
                  WhatsApp {selected.whatsapp}
                  {selected.cpf ? ` - CPF ${selected.cpf}` : ''}
                  {selected.email ? ` - ${selected.email}` : ''}
                </p>
                {selected.origin && (
                  <p className="muted-text">
                    Origem: {selected.origin.campaign ?? selected.origin.source}
                  </p>
                )}
              </div>

              {canOperate && (
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
                        placeholder={`Atual: ${selected.whatsapp} - preencha so para trocar`}
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

              {canOperate && (
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
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
