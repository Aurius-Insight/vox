// Entrypoint serverless da Vercel: embrulha a app Express existente.
//
// A convenção do Vercel descobre handlers em `api/*.ts` e os exporta como
// serverless function. Como nossa app Express ja e construida pelo factory
// `createApp()`, basta exportar o resultado — o framework cuida do resto.
//
// Localmente continua-se rodando via `npm run dev` (tsx watch src/index.ts),
// que sobe o mesmo `createApp()` em um servidor HTTP normal.
import { createApp } from '../src/app.js';

const app = createApp();

export default app;
