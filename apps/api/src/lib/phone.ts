// Utilitarios de telefone compartilhados. Centraliza a normalizacao (digitos)
// e o match de numero brasileiro com/sem o 9o digito — necessario porque a
// Cloud API da Meta devolve `wa_id` muitas vezes SEM o 9 (ex.: enviamos para
// 5561981508486 e o webhook volta como 556181508486).

/** Telefone reduzido a digitos. Strings nulas/indefinidas viram ''. */
export function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

/** Minimo de digitos para tratar um contato como valido (DDD + numero). */
export const MIN_PHONE_DIGITS = 8;

/**
 * Gera as formas equivalentes de um numero de celular brasileiro para o match
 * (com/sem codigo de pais 55, com/sem o 9o digito). Sempre inclui o proprio
 * numero normalizado. Usar com `whatsapp: { in: brazilPhoneCandidates(x) }`.
 */
export function brazilPhoneCandidates(raw: string | null | undefined): string[] {
  const digits = normalizePhone(raw);
  const out = new Set<string>();
  if (!digits) return [];
  out.add(digits);

  // Reduz para o "nacional" (DDD + assinante), tirando o 55 quando presente.
  const national = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (national.length !== 10 && national.length !== 11) return [...out];

  const ddd = national.slice(0, 2);
  const sub = national.slice(2); // 8 (sem 9) ou 9 (com 9) digitos

  let subForms: string[];
  if (sub.length === 9 && sub.startsWith('9')) {
    subForms = [sub, sub.slice(1)]; // com 9 e sem 9
  } else if (sub.length === 8) {
    subForms = [sub, `9${sub}`]; // sem 9 e com 9
  } else {
    subForms = [sub];
  }

  for (const form of subForms) {
    out.add(ddd + form); // sem codigo de pais
    out.add(`55${ddd}${form}`); // com codigo de pais
  }
  return [...out];
}

/**
 * Forma canonica para ENVIAR a um numero brasileiro pela Cloud API: garante o
 * 9o digito (13 digitos: 55 + DDD + 9 + 8). A Meta devolve `wa_id` sem o 9
 * (12 digitos), mas envios sao mais confiaveis na forma com 9 — e a lista de
 * destinatarios do numero de teste exige a forma cadastrada (com 9).
 * Numeros nao-BR ou ja com 9 passam inalterados.
 */
export function brazilSendNumber(raw: string | null | undefined): string {
  const d = normalizePhone(raw);
  // 55 + DDD(2) + assinante(8, sem o 9) -> insere o 9 apos o DDD.
  if (d.startsWith('55') && d.length === 12) {
    return `${d.slice(0, 4)}9${d.slice(4)}`;
  }
  return d;
}
