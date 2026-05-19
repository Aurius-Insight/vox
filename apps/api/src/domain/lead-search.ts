import type { Prisma } from '@prisma/client';

/**
 * Monta as condicoes OR da busca textual de leads (nome, unidade de
 * interesse, campanha e WhatsApp).
 *
 * O filtro de WhatsApp so entra quando o termo tem digitos: para um termo
 * puramente textual, `term.replace(/\D/g, '')` vira '' e `contains: ''`
 * casaria com TODOS os leads — anulando a busca inteira.
 */
export function leadSearchConditions(term: string): Prisma.LeadWhereInput[] {
  const digits = term.replace(/\D/g, '');
  return [
    { name: { contains: term, mode: 'insensitive' } },
    { unitInterest: { contains: term, mode: 'insensitive' } },
    { campaign: { contains: term, mode: 'insensitive' } },
    ...(digits ? [{ whatsapp: { contains: digits } }] : []),
  ];
}
