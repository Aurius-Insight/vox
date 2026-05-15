export function formatDateTime(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Converte o valor de um input datetime-local (YYYY-MM-DDTHH:mm) para ISO 8601. */
export function localInputToIso(value: string) {
  return new Date(value).toISOString();
}

export function formatDate(value: string) {
  return new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Formata um valor em centavos como moeda BRL. */
export function formatCents(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Converte um valor digitado em reais (ex: "1.500,00" ou "1500") para centavos. */
export function parseReaisToCents(value: string) {
  const normalized = value
    .trim()
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.]/g, '');
  const reais = Number(normalized);
  return Number.isFinite(reais) ? Math.round(reais * 100) : 0;
}
