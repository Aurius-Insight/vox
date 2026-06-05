import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiClientError } from '../api/client';

export function PortalLoginPage() {
  const [cpf, setCpf] = useState('');
  const [message, setMessage] = useState('');
  const [devLink, setDevLink] = useState('');
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) return;

    api('/api/portal/sessions', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then(() => navigate('/portal', { replace: true }))
      .catch(() => setMessage('Link invalido ou expirado.'));
  }, [navigate, searchParams]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    setDevLink('');

    try {
      const response = await api<{ sent: boolean; devMagicLink?: string }>('/api/portal/magic-links', {
        method: 'POST',
        body: JSON.stringify({ cpf }),
      });

      if (response.devMagicLink) {
        setDevLink(response.devMagicLink);
      } else {
        setMessage('Se o CPF existir, enviaremos um link de acesso pelo WhatsApp.');
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'too_many_requests') {
        setMessage('Muitas tentativas. Aguarde alguns minutos.');
        return;
      }
      setMessage('Nao foi possivel solicitar acesso agora.');
    }
  }

  // Em desenvolvimento o backend devolve o link completo; aqui transformamos
  // na rota interna para navegar sem recarregar a pagina.
  const devPath = devLink.replace(/^https?:\/\/[^/]+/, '');

  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div>
          <p className="eyebrow">Portal do aluno</p>
          <h1>Acessar aulas</h1>
        </div>
        <label>
          CPF
          <input
            value={cpf}
            onChange={(event) => setCpf(event.target.value.replace(/\D/g, '').slice(0, 11))}
            inputMode="numeric"
            autoComplete="off"
            maxLength={11}
            placeholder="Somente numeros"
          />
        </label>

        {message && <p className="form-info">{message}</p>}

        {devLink && (
          <div className="form-info dev-link">
            <span>Link magico (dev):</span>
            <Link to={devPath}>Entrar no portal agora &rarr;</Link>
            <code>{devLink}</code>
          </div>
        )}

        <button type="submit" disabled={cpf.length !== 11}>
          Enviar link magico
        </button>
      </form>
    </main>
  );
}
