'use strict';
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const config = require('./config');
const { timingSafeEqualStr } = require('./security');

const COOKIE = config.isProd ? '__Host-tp_admin' : 'tp_admin';
const BCRYPT_COST = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- password policy ----------
function passwordProblems(pw, email) {
  const p = [];
  if (typeof pw !== 'string' || pw.length < 12) p.push('at least 12 characters');
  if (pw && pw.length > 200) p.push('at most 200 characters');
  if (pw && !/[a-z]/i.test(pw)) p.push('a letter');
  if (pw && !/[0-9]/.test(pw)) p.push('a number');
  if (pw && email && pw.toLowerCase().includes(String(email).split('@')[0].toLowerCase())) p.push('not contain your email name');
  return p;
}

const hashPassword = (pw) => bcrypt.hash(pw, BCRYPT_COST);
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

// ---------- TOTP (RFC 6238) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = str.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('bad base32');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpAt(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}
function verifyTotp(secret, code) {
  if (!secret || !/^\d{6}$/.test(String(code || ''))) return false;
  const now = Math.floor(Date.now() / 30_000);
  for (const d of [-1, 0, 1]) if (timingSafeEqualStr(totpAt(secret, now + d), code)) return true;
  return false;
}
const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

// ---------- sessions ----------
async function createSession(adminId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  await db.query(
    `INSERT INTO admin_sessions(token_hash, admin_id, csrf_token, ip, user_agent, expires_at)
     VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' hours')::interval)`,
    [sha256(token), adminId, csrf, req.ip, String(req.get('user-agent') || '').slice(0, 300), String(config.sessionTtlHours)]
  );
  return token;
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'strict',
    path: '/',
    maxAge: config.sessionTtlHours * 3600 * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { httpOnly: true, secure: config.isProd, sameSite: 'strict', path: '/' });
}

async function loadSession(req) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token || token.length > 100) return null;
  const row = await db.one(
    `SELECT s.token_hash, s.csrf_token, s.admin_id, a.email, a.totp_enabled
       FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)]
  );
  if (!row) return null;
  // Sliding activity timestamp (cheap, at most once a minute).
  db.query(`UPDATE admin_sessions SET last_seen = now() WHERE token_hash = $1 AND last_seen < now() - interval '1 minute'`, [row.token_hash]).catch(() => {});
  return row;
}

async function destroySession(req) {
  const token = req.cookies && req.cookies[COOKIE];
  if (token) await db.query('DELETE FROM admin_sessions WHERE token_hash = $1', [sha256(token)]);
}

// ---------- middleware ----------
function requireAdmin() {
  return async (req, res, next) => {
    try {
      const s = await loadSession(req);
      if (!s) {
        if (req.method === 'GET') return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl.slice(0, 200)));
        return res.status(401).send('Session expired. Please log in again.');
      }
      req.admin = { id: s.admin_id, email: s.email, totpEnabled: s.totp_enabled, csrf: s.csrf_token };
      res.locals.admin = req.admin;
      res.locals.csrf = s.csrf_token;
      res.setHeader('Cache-Control', 'no-store');
      if (!['GET', 'HEAD'].includes(req.method)) {
        const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
        if (!timingSafeEqualStr(sent, s.csrf_token)) return res.status(403).send('Invalid security token. Reload the page and try again.');
      }
      next();
    } catch (e) { next(e); }
  };
}

// ---------- login ----------
async function attemptLogin(email, password, totp, req) {
  email = String(email || '').trim().toLowerCase().slice(0, 200);
  const admin = await db.one('SELECT * FROM admins WHERE email = $1', [email]);
  const log = (success) => db.query('INSERT INTO login_attempts(email, ip, success) VALUES ($1,$2,$3)', [email, req.ip, success]).catch(() => {});

  if (!admin) {
    await bcrypt.compare(String(password || ''), DUMMY_HASH); // equalise timing
    await log(false);
    return { ok: false, error: 'Incorrect email or password.' };
  }
  if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
    await log(false);
    return { ok: false, error: 'This account is temporarily locked after too many failed attempts. Try again later.' };
  }
  const pwOk = await bcrypt.compare(String(password || ''), admin.password_hash);
  const totpOk = !admin.totp_enabled || verifyTotp(admin.totp_secret, totp);
  if (!pwOk || !totpOk) {
    const fails = admin.failed_attempts + 1;
    if (fails >= MAX_FAILS) {
      await db.query(`UPDATE admins SET failed_attempts = 0, locked_until = now() + ($2 || ' minutes')::interval WHERE id = $1`, [admin.id, String(LOCK_MINUTES)]);
    } else {
      await db.query('UPDATE admins SET failed_attempts = $2 WHERE id = $1', [admin.id, fails]);
    }
    await log(false);
    if (pwOk && admin.totp_enabled) return { ok: false, error: 'Incorrect authenticator code.', needTotp: true };
    return { ok: false, error: 'Incorrect email or password.' };
  }
  await db.query('UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [admin.id]);
  await log(true);
  return { ok: true, admin };
}

// ---------- first-run setup token ----------
// When no admin exists, a one-time setup token is generated and printed to the
// server log. Only someone with access to the hosting logs can create the owner account.
let setupToken = null;
async function ensureSetupToken() {
  const row = await db.one('SELECT count(*)::int AS n FROM admins');
  if (row.n > 0) { setupToken = null; return null; }
  if (!setupToken) setupToken = crypto.randomBytes(24).toString('base64url');
  console.log('==================================================================');
  console.log(' ADMIN SETUP: no admin account exists yet. Create one here:');
  console.log(` ${config.baseUrl}/admin/setup?token=${setupToken}`);
  console.log('==================================================================');
  return setupToken;
}
function checkSetupToken(t) {
  return Boolean(setupToken && t && timingSafeEqualStr(t, setupToken));
}
function clearSetupToken() { setupToken = null; }

async function audit(req, action, detail) {
  await db.query('INSERT INTO audit_log(admin_id, action, detail, ip) VALUES ($1,$2,$3,$4)', [req.admin ? req.admin.id : null, action, detail ? String(detail).slice(0, 1000) : null, req.ip]).catch(() => {});
}

module.exports = {
  COOKIE, passwordProblems, hashPassword, verifyTotp, newTotpSecret, totpAt,
  createSession, setSessionCookie, clearSessionCookie, loadSession, destroySession,
  requireAdmin, attemptLogin, ensureSetupToken, checkSetupToken, clearSetupToken, audit, sha256,
};
