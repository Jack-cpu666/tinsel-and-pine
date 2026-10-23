'use strict';
const crypto = require('node:crypto');
const sharp = require('sharp');
const db = require('../db');

sharp.cache(false);
sharp.concurrency(1);

const MAX_BYTES = 10 * 1024 * 1024;
// Remote import is restricted to known supplier image CDNs to prevent SSRF.
const ALLOWED_HOSTS = [/(^|\.)aliexpress-media\.com$/i, /(^|\.)alicdn\.com$/i, /(^|\.)alibaba\.com$/i];

function hostAllowed(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return false;
    return ALLOWED_HOSTS.some((re) => re.test(url.hostname));
  } catch { return false; }
}

async function fetchRemote(url) {
  if (!hostAllowed(url)) throw new Error('Image host not allowed (only AliExpress/Alibaba CDNs)');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'error',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        Accept: 'image/webp,image/jpeg,image/png,*/*;q=0.5',
        Referer: 'https://www.aliexpress.us/',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new Error('Image too large');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('Image too large');
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

// Re-encodes any input to clean WebP (strips metadata, defeats polyglot uploads).
async function process(buf) {
  const img = sharp(buf, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate();
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error('Not an image');
  const full = await img.clone().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  const thumb = await img.clone().resize({ width: 480, height: 480, fit: 'cover', position: 'attention' }).webp({ quality: 78 }).toBuffer();
  return { data: full.data, width: full.info.width, height: full.info.height, thumb };
}

async function store({ productId, buf, alt = '', sourceUrl = null, sortOrder = 0 }) {
  const p = await process(buf);
  const etag = crypto.createHash('sha1').update(p.data).digest('hex').slice(0, 20);
  const row = await db.one(
    `INSERT INTO images(product_id, sort_order, alt, source_url, width, height, data, thumb, etag)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [productId, sortOrder, alt.slice(0, 200), sourceUrl, p.width, p.height, p.data, p.thumb, etag]
  );
  return row.id;
}

async function importFromUrl({ productId, url, alt, sortOrder }) {
  const buf = await fetchRemote(url);
  return store({ productId, buf, alt, sourceUrl: url, sortOrder });
}

module.exports = { store, importFromUrl, hostAllowed, process, MAX_BYTES };
