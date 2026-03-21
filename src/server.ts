import { createApp } from './app/createApp.js';
import { env } from './config/env.js';
import { startRetryWorker } from './workers/retryWorker.js';

const app = await createApp({ enableDocs: env.NODE_ENV !== 'production' });
startRetryWorker();

app.listen({ host: env.HOST, port: env.PORT }).catch((error) => {
  app.log.error(error, 'failed to start server');
  process.exit(1);
});
