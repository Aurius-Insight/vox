import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'apps/api/prisma/schema.prisma',
  migrations: {
    path: 'apps/api/prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
    // Em Supabase: DATABASE_URL aponta pro pooler (transaction mode, 6543) que
    // a app usa em runtime; DIRECT_URL pro pooler em session mode (5432) ou
    // direct, usado por migrations e introspect. Em dev local, ambos batem
    // no mesmo Postgres do Docker.
    directUrl: env('DIRECT_URL'),
  },
});
