import { FormEvent, useEffect, useState } from 'react';
import { api, ApiClientError } from '../api/client';

type Opt = { id: string; name: string };
type CadastroInfo = {
  papel: string;
  kind: 'student' | 'staff';
  needsSubject: boolean;
  units: Opt[];
  subjects: Opt[];
};

const TITULO: Record<string, string> = {
  alunos: 'Cadastro de aluno',
  professor: 'Cadastro de professor',
  coordenacao: 'Cadastro de coordenacao',
  administrador: 'Cadastro de administrador',
};

// Pagina PUBLICA padronizada (/cadastro-<papel>). Aluno cria Student
// experimental; staff cria a conta (User) com o papel do link.
export function PublicCadastroPage({ papel }: { papel: string }) {
  const [info, setInfo] = useState<CadastroInfo>();
  const [invalid, setInvalid] = useState(false);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    whatsapp: '',
    unitId: '',
    email: '',
    cpf: '',
    password: '',
    subjectId: '',
  });

  useEffect(() => {
    let active = true;
    api<{ data: CadastroInfo }>(`/api/public/cadastro/${papel}`)
      .then((r) => {
        if (active) setInfo(r.data);
      })
      .catch(() => {
        if (active) setInvalid(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [papel]);

  function update(field: keyof typeof form, value: string) {
    setForm((c) => ({ ...c, [field]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (form.name.trim().length < 2) {
      setError('Informe o nome completo.');
      return;
    }

    const isStaff = info?.kind === 'staff';
    const body: Record<string, unknown> = { name: form.name.trim() };

    if (isStaff) {
      if (!form.email.trim()) {
        setError('Informe o e-mail.');
        return;
      }
      if (form.password.length < 12) {
        setError('A senha precisa de ao menos 12 caracteres.');
        return;
      }
      if (info?.needsSubject && !form.subjectId) {
        setError('Selecione a materia.');
        return;
      }
      body.email = form.email.trim();
      body.password = form.password;
      if (form.unitId) body.unitId = form.unitId;
      if (form.subjectId) body.subjectId = form.subjectId;
    } else {
      if (form.whatsapp.replace(/\D/g, '').length < 8) {
        setError('Informe um WhatsApp valido.');
        return;
      }
      if (!form.unitId) {
        setError('Selecione a unidade.');
        return;
      }
      body.whatsapp = form.whatsapp;
      body.unitId = form.unitId;
      if (form.email.trim()) body.email = form.email.trim();
      if (form.cpf) body.cpf = form.cpf;
    }

    setSubmitting(true);
    try {
      await api(`/api/public/cadastro/${papel}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Nao foi possivel enviar agora.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <p className="muted-text">Carregando...</p>
        </div>
      </main>
    );
  }

  if (invalid || !info) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <div>
            <p className="eyebrow">Vox Rio</p>
            <h1>Cadastro indisponivel</h1>
          </div>
          <p className="muted-text">Este cadastro nao esta disponivel. Fale com a Vox Rio.</p>
        </div>
      </main>
    );
  }

  if (done) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <div>
            <p className="eyebrow">Vox Rio</p>
            <h1>Cadastro recebido! 🎉</h1>
          </div>
          <p className="muted-text">
            {info.kind === 'staff'
              ? 'Sua conta foi criada. Voce ja pode acessar com seu e-mail e senha.'
              : 'Recebemos seus dados. Em breve a equipe da Vox Rio entra em contato.'}
          </p>
        </div>
      </main>
    );
  }

  const isStaff = info.kind === 'staff';

  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div>
          <p className="eyebrow">Vox Rio</p>
          <h1>{TITULO[papel] ?? 'Cadastro'}</h1>
        </div>

        <label>
          Nome completo
          <input
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            autoComplete="name"
            autoFocus
          />
        </label>

        {isStaff ? (
          <>
            <label>
              E-mail
              <input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                autoComplete="email"
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                placeholder="Min. 12 caracteres"
                autoComplete="new-password"
              />
            </label>
            {info.needsSubject && (
              <label>
                Materia
                <select value={form.subjectId} onChange={(e) => update('subjectId', e.target.value)}>
                  <option value="">Selecione a materia...</option>
                  {info.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Escola (opcional)
              <select value={form.unitId} onChange={(e) => update('unitId', e.target.value)}>
                <option value="">Sem escola fixa</option>
                {info.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <label>
              WhatsApp
              <input
                value={form.whatsapp}
                onChange={(e) => update('whatsapp', e.target.value)}
                placeholder="(21) 90000-0000"
                inputMode="tel"
                autoComplete="tel"
              />
            </label>
            <label>
              Unidade
              <select value={form.unitId} onChange={(e) => update('unitId', e.target.value)}>
                <option value="">Selecione a unidade...</option>
                {info.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              E-mail (opcional)
              <input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                autoComplete="email"
              />
            </label>
            <label>
              CPF (opcional)
              <input
                value={form.cpf}
                onChange={(e) => update('cpf', e.target.value.replace(/\D/g, '').slice(0, 11))}
                placeholder="Somente numeros"
                inputMode="numeric"
                maxLength={11}
              />
            </label>
          </>
        )}

        {error && <p className="form-error">{error}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Enviando...' : 'Enviar cadastro'}
        </button>
      </form>
    </main>
  );
}
