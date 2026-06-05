import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.string().min(1),
  // Usado pelas migrations (Prisma direct connection). Em dev local pode ser
  // igual ao DATABASE_URL; em prod com Supabase, deve ser a URL "Direct"
  // (porta 5432), enquanto DATABASE_URL e a do pooler (porta 6543).
  DIRECT_URL: z.string().optional(),
  // Em prod (Vercel) usamos Vercel KV via HTTP — REDIS_URL fica opcional.
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  SESSION_SECRET: z.string().min(32),
  WEBHOOK_SECRET: z.string().min(24),
  // Salt dedicado pra hash de CPF. Opcional: se ausente, cai pro
  // SESSION_SECRET (comportamento legado — preserva hashes ja salvos).
  // Em prod novo, definir um valor independente: se SESSION_SECRET vazar,
  // os hashes de CPF ficam protegidos por outra chave.
  CPF_HASH_SALT: z.string().min(32).optional(),
  ADMIN_EMAIL: z.string().email().default('admin@voxrj.com'),
  ADMIN_PASSWORD: z.string().min(12),
  // Opcional: sem a chave, o envio do magic link via BotConversa fica como
  // no-op (e em dev o `devMagicLink` continua sendo devolvido na resposta).
  BOTCONVERSA_API_KEY: z.string().optional(),
  // Tokens secretos dos links publicos de auto-cadastro (um por tipo de
  // aluno). Sem eles, o endpoint publico responde 404 (feature desligada).
  // Cada link tem a forma /cadastro/<token>; o token define o tipo do aluno.
  PUBLIC_SIGNUP_TOKEN_MATRICULADO: z.string().min(16).optional(),
  PUBLIC_SIGNUP_TOKEN_EXPERIMENTAL: z.string().min(16).optional(),
  // --- WhatsApp Cloud API (modo Coexistence/CoEx) ---
  // Todas opcionais: sem elas, o cliente (`lib/whatsapp.ts`) vira no-op e o
  // webhook segue respondendo a verificacao. Ver docs/PLANO_CHAT_COEX.md.
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_WABA_ID: z.string().optional(),
  // Token de acesso (System User de longa duracao em prod; temporario em dev).
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  // App Secret do app Meta — valida a assinatura `X-Hub-Signature-256`.
  WHATSAPP_APP_SECRET: z.string().optional(),
  // Token arbitrario que casamos no GET de verificacao do webhook (Meta).
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  // Versao da Graph API (ex.: v23.0). Default cobre o uso atual.
  WHATSAPP_API_VERSION: z.string().default('v23.0'),
  // App ID do app Meta (publico) — usado na troca do code do Embedded Signup.
  WHATSAPP_APP_ID: z.string().optional(),
  // Configuration ID do Embedded Signup (publico) — dirige o FB.login no front.
  WHATSAPP_ES_CONFIG_ID: z.string().optional(),
  // featureType do Embedded Signup p/ Coexistencia (extras do FB.login).
  WHATSAPP_ES_FEATURE_TYPE: z.string().default('whatsapp_business_app_onboarding'),
});

export const env = EnvSchema.parse(process.env);

export const isProduction = env.NODE_ENV === 'production';
