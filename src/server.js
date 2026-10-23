'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const config = require('./config');
const db = require('./db');
const security = require('./security');
const auth = require('./auth');
const { seedIfEmpty } = require('./seed');
const jobs = require('./services/jobs');
const storeViews = require('./views/store');
const adminViews = require('./views/admin');

// Cache-busting version for static assets, derived from their contents.
const staticDir = path.join(__dirname, '..', 'public');
const assetVersion = crypto.createHash('sha1')
  .update(['css/store.css', 'css/admin.css', 'js/store.js', 'js/admin.js', 'js/pixel.js'].map((f) => { try { return fs.readFileSync(path.join(staticDir, f)); } catch { return ''; } }).join('|'))
  .digest('hex').slice(0, 10);
storeViews.setAssetVersion(assetVersion);
adminViews.setAssetVersion(assetVersion);

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render terminates TLS at one proxy hop
  app.set('etag', 'strong');

  app.use(security.nonce);
  app.use(security.headers());
  app.use(security.permissionsPolicy);
  app.use(compression());

  // HTTPS redirect in production (behind Render's proxy).
  if (config.isProd) {
    app.use((req, res, next) => {
      if (req.secure || req.path === '/api/health') return next();
      return res.redirect(301, 'https://' + req.get('host') + req.originalUrl);
    });
  }

  app.use('/static', express.static(staticDir, { maxAge: config.isProd ? '30d' : 0, immutable: config.isProd, index: false, dotfiles: 'deny' }));
  app.use(require('./routes/images'));
  app.use(require('./routes/webhook')); // raw body, must be before JSON parser

  app.use(security.limiters.global);
  app.use(express.json({ limit: '50kb' }));
  app.use(express.urlencoded({ extended: true, limit: '200kb', parameterLimit: 2000 }));
  app.use(cookieParser());
  app.use(security.sameOrigin);

  app.use('/api', require('./routes/api'));
  app.use('/admin', require('./routes/admin'));
  const store = require('./routes/store');
  app.use(store.router);

  app.use(async (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    try { await store.send(req, res, { title: 'Not found', body: storeViews.notFound(), noindex: true }, 404); } catch { res.status(404).send('Not found'); }
  });

  // eslint-disable-next-line no-unused-vars
  app.use(async (err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('[error]', req.method, req.path, err.stack || err.message);
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 10 MB).' });
    if (res.headersSent) return;
    if (req.path.startsWith('/api/') || (req.get('accept') || '').includes('application/json')) {
      return res.status(status).json({ error: status >= 500 ? 'Server error' : err.expose ? err.message : 'Bad request' });
    }
    if (req.path.startsWith('/admin')) return res.status(status).type('text').send(status >= 500 ? 'Server error — check the logs.' : 'Bad request');
    try { await store.send(req, res, { title: 'Error', body: storeViews.errorPage(), noindex: true }, status); } catch { res.status(status).send('Error'); }
  });
  return app;
}

async function start() {
  await db.migrate();
  if (config.seedOnBoot) await seedIfEmpty();
  await auth.ensureSetupToken();
  const app = createApp();
  const server = app.listen(config.port, () => console.log(`[server] ${config.storeName} listening on :${config.port} (${config.isProd ? 'production' : 'development'})`));
  server.headersTimeout = 65_000;
  server.requestTimeout = 60_000;
  jobs.start();
  const shutdown = () => {
    console.log('[server] shutting down');
    server.close(() => db.pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (require.main === module) {
  start().catch((e) => { console.error('[fatal]', e); process.exit(1); });
}

module.exports = { createApp, start };
