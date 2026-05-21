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

/** Inversa de `localInputToIso`: ISO 8601 -> "YYYY-MM-DDTHH:mm" no fuso local. */
export function isoToLocalInput(value: string) {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
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

/**
 * Monta o link wa.me a partir de um telefone brasileiro. Usa o tamanho para
 * decidir o codigo do pais: 10-11 digitos = DDD + numero (prefixa 55);
 * 12-13 = ja vem com o 55. Devolve `null` quando o numero nao e reconhecivel.
 */
export function whatsappLink(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) {
    return `https://wa.me/55${digits}`;
  }
  if (digits.length === 12 || digits.length === 13) {
    return `https://wa.me/${digits}`;
  }
  return null;
}
