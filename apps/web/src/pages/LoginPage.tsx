import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { firstAccessibleRoute } from '../lib/navigation';

export function LoginPage() {
  const auth = useAuth();
  const [email, setEmail] = useState('admin@voxrj.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (auth.status === 'authenticated') {
    return <Navigate to={firstAccessibleRoute(auth.user?.roles ?? [])} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');

    try {
      await auth.login(email, password);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'too_many_requests') {
        setError('Muitas tentativas. Aguarde alguns minutos.');
        return;
      }
      setError('E-mail ou senha invalidos.');
    }
  }

  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div>
          <p className="eyebrow">Vox Rio MVP</p>
          <h1>Entrar no sistema</h1>
        </div>
        <label>
          E-mail
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" />
        </label>
        <label>
          Senha
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit">Entrar</button>
      </form>
    </main>
  );
}
