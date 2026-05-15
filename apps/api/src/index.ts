import { env } from './config/env.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';

const app = createApp();

app.listen(env.PORT, () => {
  logger.info('api_started', { port: env.PORT });
});
