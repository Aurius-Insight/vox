import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiClientError, api } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import type { Package, StudentDetail, StudentSummary, Unit } from '../api/types';
import { formatDate, formatDateTime } from '../lib/format';

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

export function AlunosPage() {
  const auth = useAuth();
  const canCreate = (auth.user?.roles ?? []).some((role) => role === 'diretor');
  // Renovacao opera vendas: diretor + coordenacao podem (igual ao convert).
  const canRenew = (auth.user?.roles ?? []).some(
    (role) => role === 'diretor' || role === 'coordenacao',
  );

  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selected, setSelected] = useState<StudentDetail>();
  const [form, setForm] = useState<StudentForm>(EMPTY_FORM);
  const [renewPackageId, setRenewPackageId] = useState('');
  const [renewSaving, setRenewSaving] = useState(false);
  const [linkPendingId, setLinkPendingId] = useState<string>();
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
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

  function updateField(field: keyof StudentForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
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

      {error && <p className="form-error">{error}</p>}
      {info && <p className="form-info">{info}</p>}

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

              {canRenew && (
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
