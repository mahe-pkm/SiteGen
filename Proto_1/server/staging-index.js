import { createStagingGateway } from './staging-gateway.js';
const config = {
  stagingHost: process.env.STAGING_HOST || '', stagingToken: process.env.STAGING_DEPLOY_TOKEN || '',
  stagingUsername: process.env.STAGING_REVIEW_USERNAME || 'review', stagingPassword: process.env.STAGING_REVIEW_PASSWORD || '',
  dataDir: process.env.DATA_DIR || '/data', routeFile: process.env.STAGING_ROUTE_FILE || '',
  googleKey: process.env.GOOGLE_MAPS_API_KEY || '', lookupDailyLimit: Number(process.env.LOOKUP_DAILY_LIMIT || 100), photoDailyLimit: Number(process.env.PHOTO_DAILY_LIMIT || 300),
};
const app = createStagingGateway(config);
await app.locals.refreshRoutes();
const server = app.listen(3100, '0.0.0.0', () => console.log('Private staging gateway listening on port 3100.'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(async () => { await app.locals.close(); process.exit(0); });
});
