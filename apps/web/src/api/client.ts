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
    throw new ApiClientError(
      response.status,
      body.error?.code ?? 'request_failed',
      body.error?.message ?? 'Falha na requisicao.',
    );
  }

  return body;
}
