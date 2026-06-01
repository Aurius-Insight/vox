import { PrismaClient, type Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

// Cria/atualiza o usuario de teste usado pelo analista da Meta no App Review.
// Papel `coordenacao` (acesso ao Atendimento). Trocar para o papel restrito de
// revisor quando ele existir, antes da analise rodar.
//
// Senha e email vem por env (nunca hardcoded):
//   docker exec -e REVIEWER_EMAIL=... -e REVIEWER_PASSWORD=... vox-api \
//     npx tsx apps/api/scripts/create-reviewer.ts

const pool = new Pool({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const EMAIL = process.env.REVIEWER_EMAIL ?? 'reviewer@voxrio.xyz';
const PASSWORD = process.env.REVIEWER_PASSWORD;
if (!PASSWORD || PASSWORD.length < 12) {
  throw new Error('REVIEWER_PASSWORD obrigatorio (min 12 chars).');
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const roles: Role[] = [(process.env.REVIEWER_ROLE as Role) ?? 'revisor'];
  const user = await prisma.user.upsert({
    where: { email: EMAIL.toLowerCase() },
    update: { name: 'App Reviewer', passwordHash, roles, active: true },
    create: { name: 'App Reviewer', email: EMAIL.toLowerCase(), passwordHash, roles, active: true },
  });
  console.log('OK reviewer:', user.email, user.roles, 'active=' + user.active);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
