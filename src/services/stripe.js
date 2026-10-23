'use strict';
const Stripe = require('stripe');
const config = require('../config');
const settings = require('./settings');

let cached = { key: null, client: null };

async function secretKey() {
  return config.stripeSecretKey || (await settings.getSecret('stripe_secret_key'));
}

async function webhookSecret() {
  return config.stripeWebhookSecret || (await settings.getSecret('stripe_webhook_secret'));
}

async function client() {
  const key = await secretKey();
  if (!key) return null;
  if (cached.key !== key) {
    cached = { key, client: new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: 'TinselPine' } }) };
  }
  return cached.client;
}

function keyMode(key) {
  if (!key) return 'missing';
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  return 'invalid';
}

module.exports = { client, secretKey, webhookSecret, keyMode };
