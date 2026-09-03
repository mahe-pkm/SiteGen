import express from 'express';
import path from 'node:path';
import { loadConfig } from './config.js';
import { createApp, errors } from './app.js';

const dev = process.argv.includes('--dev');
const config = loadConfig({ dev });
const app = createApp(config);
let vite;
if (dev) {
  const { createServer } = await import('vite');
  vite = await createServer({ root: config.root, server: { middlewareMode: true, watch: { ignored: [`${config.dataDir.replaceAll('\\', '/')}/**`, '**/local-server*.log'] } }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(config.root, 'dist')));
  app.get('/', (_req, res) => res.sendFile(path.join(config.root, 'dist', 'index.html')));
}
app.use(errors);
const server = app.listen(config.port, config.host, () => {
  console.log(`Proto_1: http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}/`);
  console.log(`Google: ${config.googleKey ? 'configured' : 'not configured'}; external deployment: ${config.publicDeployEnabled ? 'enabled' : 'disabled'}`);
});
server.on('error', async (error) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${config.port} is in use. Set PORT to a different port.` : error.message);
  await vite?.close();
  app.locals.store.close();
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    server.close();
    await app.locals.jobs.drain();
    await vite?.close();
    app.locals.store.close();
    process.exit(0);
  });
}
