export type ConversionCheck = { ok: true } | { ok: false; reason: 'already_enrolled' };

/**
 * Um lead pode ser convertido se ainda nao tem aluno OU se o aluno existente e
 * experimental — nesse caso a conversao apenas o "promove" a matriculado. So
 * bloqueia quando ja existe um aluno matriculado vinculado.
 */
export function canConvertLead(input: {
  studentType?: 'experimental' | 'matriculado' | null;
}): ConversionCheck {
  if (input.studentType === 'matriculado') return { ok: false, reason: 'already_enrolled' };
  return { ok: true };
}

/**
 * Gera um codigo de matricula candidato no formato VX-0000. A unicidade e
 * garantida por quem chama (consulta o banco e tenta de novo em caso de
 * colisao), porque so o banco conhece os codigos ja usados.
 */
export function randomEnrollmentCode(): string {
  const digits = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `VX-${digits}`;
}

/**
 * Gera um codigo de matricula unico. Recebe um callback que diz se um codigo ja
 * existe (consulta ao banco fica fora do dominio) e tenta de novo em caso de
 * colisao, ate um limite de tentativas.
 */
export async function uniqueEnrollmentCode(
  exists: (code: string) => Promise<boolean>,
  maxAttempts = 10,
): Promise<string> {
  let code = randomEnrollmentCode();
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!(await exists(code))) return code;
    code = randomEnrollmentCode();
  }
  return code;
}
