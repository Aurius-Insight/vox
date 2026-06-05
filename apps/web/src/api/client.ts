export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type ApiErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const body = (await response.json()) as T & ApiErrorResponse;

  if (!response.ok) {
    // Sessao expirada/ausente: avisa o app pra deslogar e ir pro login. Um
    // evento desacopla este client do React Router; o AuthProvider so age se
    // o staff estiver autenticado, entao 401 de login/me/portal sao inofensivos.
    // O portal trata o proprio 401 (rota /api/portal/*), por isso e excluido.
    if (
      response.status === 401 &&
      typeof window !== 'undefined' &&
      !path.startsWith('/api/portal/')
    ) {
      window.dispatchEvent(new CustomEvent('vox:unauthorized'));
    }
    throw new ApiClientError(
      response.status,
      body.error?.code ?? 'request_failed',
      body.error?.message ?? 'Falha na requisicao.',
    );
  }

  return body;
}
