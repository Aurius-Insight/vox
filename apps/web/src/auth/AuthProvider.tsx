import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';

export type Role = 'diretor' | 'coordenacao' | 'professor' | 'revisor';

export type User = {
  id: string;
  name: string;
  email: string;
  roles: Role[];
};

type AuthStatus = 'loading' | 'authenticated' | 'guest';

type AuthContextValue = {
  status: AuthStatus;
  user?: User;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | undefined>();

  async function refresh() {
    try {
      const response = await api<{ user: User }>('/api/auth/me');
      setUser(response.user);
      setStatus('authenticated');
    } catch {
      setUser(undefined);
      setStatus('guest');
    }
  }

  async function login(email: string, password: string) {
    const response = await api<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setUser(response.user);
    setStatus('authenticated');
  }

  async function logout() {
    await api<void>('/api/auth/logout', { method: 'POST' });
    setUser(undefined);
    setStatus('guest');
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Sessao expirou enquanto a aba estava aberta: o client de API emite
  // 'vox:unauthorized' em qualquer 401. So agimos saindo de 'authenticated'
  // (transicao -> 'guest'), o que faz o RequireAuth redirecionar pro /login.
  // 401 esperado (login com senha errada, /me inicial de visitante) nao mexe
  // em nada porque o status ja nao e 'authenticated'.
  useEffect(() => {
    function onUnauthorized() {
      setStatus((prev) => (prev === 'authenticated' ? 'guest' : prev));
      setUser((prev) => (prev ? undefined : prev));
    }
    window.addEventListener('vox:unauthorized', onUnauthorized);
    return () => window.removeEventListener('vox:unauthorized', onUnauthorized);
  }, []);

  const value = useMemo(
    () => ({ status, user, login, logout, refresh }),
    [status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth precisa estar dentro de AuthProvider.');
  }
  return context;
}
