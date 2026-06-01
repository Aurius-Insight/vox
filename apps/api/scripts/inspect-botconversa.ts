// Inspecao READ-ONLY da conta BotConversa: lista custom fields, tags e uma
// amostra de contatos reais. Serve para descobrir de onde vem "unidade" e
// "campanha" antes de mapear o webhook. Nao escreve nada, nao toca no banco.
//
// Uso: npx tsx apps/api/scripts/inspect-botconversa.ts
// Requer BOTCONVERSA_API_KEY no ambiente ou num .env em qualquer diretorio
// acima do cwd (a chave nunca e impressa).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const BASE = 'https://backend.botconversa.com.br/api/v1/webhook';

// Procura BOTCONVERSA_API_KEY no process.env ou subindo diretorios atras de
// um .env que a contenha. Isola o projeto da bagunca de cwd entre dev/prod.
function findApiKey(): string | undefined {
  if (process.env.BOTCONVERSA_API_KEY) return process.env.BOTCONVERSA_API_KEY;
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    try {
      const content = readFileSync(resolve(dir, '.env'), 'utf8');
      const match = content.match(/^\s*BOTCONVERSA_API_KEY\s*=\s*(.+?)\s*$/m);
      const value = match?.[1]?.replace(/^["']|["']$/g, '').trim();
      if (value) return value;
    } catch {
      // sem .env legivel aqui — sobe um nivel
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const apiKey = findApiKey();
if (!apiKey) {
  console.error('BOTCONVERSA_API_KEY ausente (process.env e .env). Abortado.');
  process.exit(1);
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'API-KEY': apiKey as string, accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} em ${path}: ${await res.text().catch(() => '')}`);
  }
  return res.json() as Promise<T>;
}

// Mascara PII: preserva o formato, esconde o valor.
const maskPhone = (p: unknown): string => (p ? `...${String(p).slice(-4)}` : '(sem)');
const maskName = (n: unknown): string => (n ? `${String(n).trim().slice(0, 1)}***` : '(sem)');

type CustomField = { id: number; key: string; type: string };
type Tag = { id: number; name: string };
type Subscriber = {
  id: number;
  full_name?: string | null;
  phone?: string | null;
  tags?: unknown[];
  campaigns?: unknown[];
  variables?: Record<string, unknown>;
};
type Page<T> = { count?: number; results?: T[] };

async function main(): Promise<void> {
  console.log('=== CUSTOM FIELDS (campos personalizados) ===');
  const fields = await api<CustomField[]>('/custom_fields/');
  for (const f of fields) console.log(`  [${f.id}] key="${f.key}" type="${f.type}"`);
  console.log(`  total: ${fields.length}\n`);

  console.log('=== TAGS ===');
  const tags = await api<Tag[]>('/tags/');
  for (const t of tags) console.log(`  [${t.id}] ${t.name}`);
  console.log(`  total: ${tags.length}\n`);

  console.log('=== AMOSTRA DE CONTATOS (ate 5, nome/telefone mascarados) ===');
  const page = await api<Page<Subscriber>>('/subscribers/?page=1');
  const sample = (page.results ?? []).slice(0, 5);
  for (const s of sample) {
    console.log(`  contato ${s.id}: nome=${maskName(s.full_name)} tel=${maskPhone(s.phone)}`);
    console.log(`    tags:      ${JSON.stringify(s.tags ?? [])}`);
    console.log(`    campaigns: ${JSON.stringify(s.campaigns ?? [])}`);
    if (s.variables) console.log(`    variables: ${JSON.stringify(s.variables)}`);
    console.log('');
  }
  console.log(`  total de contatos na conta: ${page.count ?? '?'}`);
}

main().catch((error: unknown) => {
  console.error('inspecao falhou:', error instanceof Error ? error.message : error);
  process.exit(1);
});
