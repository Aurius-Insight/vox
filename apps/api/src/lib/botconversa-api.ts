// Cliente HTTP fino da API do BotConversa, voltado para LEITURA paginada
// pelos scripts de sincronizacao (import em lote e poll incremental).
// O cliente de ENVIO em runtime (magic link) e o `botconversa.ts`.

const BASE_URL = 'https://backend.botconversa.com.br/api/v1/webhook';

/** Tamanho de pagina padrao da listagem de contatos do BotConversa. */
export const SUBSCRIBERS_PER_PAGE = 25;

export type BotConversaTag = { id: number; name: string };

export type BotConversaPage<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

/**
 * Numeros das ultimas `howMany` paginas da listagem de contatos. A API ordena
 * do mais antigo para o mais novo, entao os contatos recentes ficam no fim —
 * por isso o poll incremental le o final da lista.
 */
export function lastPageNumbers(count: number, perPage: number, howMany = 2): number[] {
  if (count <= 0 || perPage <= 0) return [];
  const last = Math.ceil(count / perPage);
  const first = Math.max(1, last - howMany + 1);
  const pages: number[] = [];
  for (let page = first; page <= last; page += 1) pages.push(page);
  return pages;
}

export type BotConversaApi = ReturnType<typeof createBotConversaApi>;

/** Cria um cliente de leitura da API do BotConversa atrelado a uma API key. */
export function createBotConversaApi(apiKey: string) {
  async function fetchJson<T>(path: string): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: { 'API-KEY': apiKey, accept: 'application/json' },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`BotConversa HTTP ${response.status} em ${path}: ${body}`);
    }
    return response.json() as Promise<T>;
  }

  return {
    /** Catalogo de tags da conta. */
    getTags: () => fetchJson<BotConversaTag[]>('/tags/'),
    /** Uma pagina (1-indexada) da listagem de contatos. */
    getSubscribersPage: <T>(page: number) =>
      fetchJson<BotConversaPage<T>>(`/subscribers/?page=${page}`),
  };
}
