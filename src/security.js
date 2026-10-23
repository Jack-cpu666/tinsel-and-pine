'use strict';
const crypto = require('node:crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');

function nonce(req, res, next) {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
}

function headers() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'", 'https://checkout.stripe.com'],
        scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`, 'https://connect.facebook.net'],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://www.facebook.com'],
        connectSrc: ["'self'", 'https://www.facebook.com', 'https://connect.facebook.net'],
        frameSrc: ["'none'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
}

function permissionsPolicy(req, res, next) {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.stripe.com"), usb=()');
  next();
}


const limiters = {
  global: rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }),
  api: rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }),
  checkout: rateLimit({ windowMs: 10 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many checkout attempts. Please wait a few minutes and try again.' } }),
  login: rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
    message: 'Too many login attempts. Try again in 15 minutes.' }),
  forms: rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
    message: 'Too many submissions. Please try again later.' }),
  track: rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: false, legacyHeaders: false }),
};

// Reject cross-site state-changing requests (defence in depth on top of CSRF tokens + SameSite cookies).
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/stripe/webhook') return next();
  const origin = req.get('origin');
  const host = req.get('host');
  if (origin) {
    try {
      if (new URL(origin).host !== host) return res.status(403).send('Cross-origin request blocked');
    } catch {
      return res.status(403).send('Bad origin');
    }
  } else {
    const site = req.get('sec-fetch-site');
    if (site && !['same-origin', 'none'].includes(site)) return res.status(403).send('Cross-site request blocked');
  }
  next();
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = { nonce, headers, permissionsPolicy, limiters, sameOrigin, timingSafeEqualStr };
