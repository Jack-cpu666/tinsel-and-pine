'use strict';
const crypto = require('node:crypto');

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function required(name) {
  const v = env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

// APP_SECRET protects encrypted settings and analytics salts. In production it
// must be provided (Render generates it via render.yaml "generateValue").
let appSecret = env.APP_SECRET;
if (!appSecret) {
  if (isProd) appSecret = required('APP_SECRET');
  appSecret = 'dev-only-secret-' + crypto.createHash('sha256').update(__dirname).digest('hex');
}
if (appSecret.length < 32) throw new Error('APP_SECRET must be at least 32 characters');

module.exports = {
  isProd,
  port: Number(env.PORT || 3000),
  databaseUrl: env.DATABASE_URL || 'postgres://postgres:pw@localhost:5433/shop',
  // Optional: keep all tables in their own schema (lets the store share a database safely).
  dbSchema: /^[a-z_][a-z0-9_]{0,40}$/.test(env.DB_SCHEMA || '') ? env.DB_SCHEMA : null,
  databaseSsl: env.DATABASE_SSL === 'true' || (isProd && env.DATABASE_SSL !== 'false' && !/localhost|127\.0\.0\.1|\.internal|dpg-[a-z0-9]+-a(\/|:|$)/.test(env.DATABASE_URL || '')),
  appSecret,
  baseUrl: (env.BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  stripeSecretKey: env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  storeName: env.STORE_NAME || 'Tinsel & Pine',
  currency: 'usd',
  sessionTtlHours: 12,
  maxCartLines: 30,
  maxQtyPerLine: 50,
  seedOnBoot: env.SEED_ON_BOOT !== 'false',
};
