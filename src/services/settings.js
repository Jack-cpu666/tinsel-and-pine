'use strict';
const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');

const KEY = crypto.createHash('sha256').update('settings-encryption:' + config.appSecret).digest();

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'v1:' + Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(blob) {
  if (!blob || !blob.startsWith('v1:')) return '';
  const raw = Buffer.from(blob.slice(3), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// Public (non-secret) settings with defaults. Cached briefly.
const DEFAULTS = {
  store_name: config.storeName,
  announcement: 'FREE 5-day shipping on every order · Order by Dec 18 for Christmas delivery',
  support_email: '',
  hero_title: 'Make this Christmas glow',
  hero_subtitle: 'Hand-picked lights, cozy decor and stocking-stuffers — free US shipping on everything.',
  christmas_cutoff: 'December 18',
  meta_pixel_id: '',
  checkout_enabled: 'true',
};

let cache = null;
let cacheAt = 0;

async function all() {
  if (cache && Date.now() - cacheAt < 15_000) return cache;
  const rows = await db.many('SELECT key, value, secret FROM settings');
  const out = { ...DEFAULTS };
  for (const r of rows) if (!r.secret) out[r.key] = r.value;
  cache = out;
  cacheAt = Date.now();
  return out;
}

async function set(key, value) {
  await db.query(
    `INSERT INTO settings(key, value, secret, updated_at) VALUES ($1,$2,false,now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, secret = false, updated_at = now()`,
    [key, String(value)]
  );
  cache = null;
}

async function setSecret(key, value) {
  if (!value) {
    await db.query('DELETE FROM settings WHERE key = $1 AND secret = true', [key]);
  } else {
    await db.query(
      `INSERT INTO settings(key, value, secret, updated_at) VALUES ($1,$2,true,now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, secret = true, updated_at = now()`,
      [key, encrypt(value)]
    );
  }
  cache = null;
}

async function getSecret(key) {
  const row = await db.one('SELECT value FROM settings WHERE key = $1 AND secret = true', [key]);
  if (!row) return '';
  try {
    return decrypt(row.value);
  } catch {
    console.error(`[settings] could not decrypt ${key} (APP_SECRET changed?)`);
    return '';
  }
}

module.exports = { all, set, setSecret, getSecret, encrypt, decrypt, DEFAULTS };
