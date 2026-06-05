import { PrismaClient, type Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Troca apenas o PAPEL do usuario de teste do App Review (sem tocar na senha).
// Default: reviewer@voxrio.xyz -> revisor. Nenhum segredo na linha de comando.
//   docker exec vox-api npx tsx apps/api/scripts/set-reviewer-role.ts

const pool = new Pool({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const EMAIL = (process.env.REVIEWER_EMAIL ?? 'reviewer@voxrio.xyz').toLowerCase();
const ROLE = (process.env.REVIEWER_ROLE ?? 'revisor') as Role;

async function main() {
  const user = await prisma.user.update({ where: { email: EMAIL }, data: { roles: [ROLE] } });
  console.log('OK role:', user.email, user.roles);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
