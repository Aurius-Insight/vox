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
  ADMIN_EMAIL: z.string().email().default('admin@voxrj.com'),
  ADMIN_PASSWORD: z.string().min(12),
  // Opcional: sem a chave, o envio do magic link via BotConversa fica como
  // no-op (e em dev o `devMagicLink` continua sendo devolvido na resposta).
  BOTCONVERSA_API_KEY: z.string().optional(),
});

export const env = EnvSchema.parse(process.env);

export const isProduction = env.NODE_ENV === 'production';
