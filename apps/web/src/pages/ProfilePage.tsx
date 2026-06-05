import { FormEvent, useState } from 'react';
import { api, ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../components/ToastProvider';

// Auto-edicao do proprio usuario (professor, coordenacao, diretor): nome e
// senha. E-mail (login) e papeis nao sao editaveis aqui.
export function ProfilePage() {
  const auth = useAuth();
  const toast = useToast();
  const [name, setName] = useState(auth.user?.name ?? '');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) {
      toast.error('Informe seu nome.');
      return;
    }
    if (password && password.length < 12) {
      toast.error('A nova senha precisa de ao menos 12 caracteres.');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name: name.trim() };
      if (password) body.password = password;
      await api('/api/auth/me', { method: 'PATCH', body: JSON.stringify(body) });
      await auth.refresh();
      setPassword('');
      toast.success('Dados atualizados.');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Nao foi possivel salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="app-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Conta</p>
          <h1>Meu perfil</h1>
        </div>
      </header>

      <section className="table-card">
        <form className="grid-form" onSubmit={handleSubmit}>
          <label>
            Nome
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            E-mail
            <input value={auth.user?.email ?? ''} disabled />
          </label>
          <label>
            Nova senha (opcional)
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Deixe em branco para manter"
              autoComplete="new-password"
            />
          </label>
          <div className="grid-form-actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
