import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiClientError } from '../api/client';

type Unit = { id: string; name: string };
type SignupInfo = { tipo: 'matriculado' | 'experimental'; units: Unit[] };

type SignupForm = {
  name: string;
  whatsapp: string;
  unitId: string;
  email: string;
  cpf: string;
};

const EMPTY: SignupForm = { name: '', whatsapp: '', unitId: '', email: '', cpf: '' };

// Pagina PUBLICA (sem login): o aluno acessa pelo link com token e preenche o
// proprio cadastro. O token (na URL) define o tipo de aluno no backend.
export function PublicSignupPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState<SignupInfo>();
  const [invalid, setInvalid] = useState(false);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<SignupForm>(EMPTY);

  useEffect(() => {
    let active = true;
    api<{ data: SignupInfo }>(`/api/public/signup/${token}`)
      .then((response) => {
        if (active) setInfo(response.data);
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
  }, [token]);

  function update(field: keyof SignupForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');

    if (form.name.trim().length < 2) {
      setError('Informe seu nome completo.');
      return;
    }
    if (form.whatsapp.replace(/\D/g, '').length < 8) {
      setError('Informe um WhatsApp valido.');
      return;
    }
    if (!form.unitId) {
      setError('Selecione a unidade.');
      return;
    }
    if (form.cpf.length !== 11) {
      setError('Informe seu CPF (11 digitos).');
      return;
    }

    setSubmitting(true);
    try {
      const response = await api<{ data: { ok: boolean; portal: boolean } }>(
        `/api/public/signup/${token}`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: form.name.trim(),
            whatsapp: form.whatsapp,
            unitId: form.unitId,
            email: form.email.trim() || undefined,
            cpf: form.cpf,
          }),
        },
      );
      // Matriculado ja entra logado no portal: cai direto na selecao de aulas.
      if (response.data.portal) {
        navigate('/portal', { replace: true });
        return;
      }
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

  if (invalid) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <div>
            <p className="eyebrow">Vox Rio</p>
            <h1>Link invalido</h1>
          </div>
          <p className="muted-text">
            Este link de cadastro nao e valido ou expirou. Fale com a equipe da Vox Rio.
          </p>
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
            Recebemos seus dados. Em breve a equipe da Vox Rio entra em contato pelo WhatsApp.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div>
          <p className="eyebrow">Vox Rio</p>
          <h1>Faca seu cadastro</h1>
        </div>

        <label>
          Nome completo
          <input
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder="Seu nome"
            autoComplete="name"
            autoFocus
          />
        </label>

        <label>
          WhatsApp
          <input
            value={form.whatsapp}
            onChange={(event) => update('whatsapp', event.target.value)}
            placeholder="(21) 90000-0000"
            inputMode="tel"
            autoComplete="tel"
          />
        </label>

        <label>
          Unidade
          <select value={form.unitId} onChange={(event) => update('unitId', event.target.value)}>
            <option value="">Selecione a unidade...</option>
            {info?.units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          E-mail (opcional)
          <input
            type="email"
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
            placeholder="email@exemplo.com"
            autoComplete="email"
          />
        </label>

        <label>
          CPF
          <input
            value={form.cpf}
            onChange={(event) => update('cpf', event.target.value.replace(/\D/g, '').slice(0, 11))}
            placeholder="Somente numeros (usado para acessar suas aulas)"
            inputMode="numeric"
            maxLength={11}
          />
        </label>

        {error && <p className="form-error">{error}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Enviando...' : 'Enviar cadastro'}
        </button>
      </form>
    </main>
  );
}
