'use strict';
// Tiny auto-escaping template system.
// html`<p>${userText}</p>` escapes interpolations; raw(...) or nested html`` results are trusted.

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
function escape(v) {
  return String(v).replace(/[&<>"'`]/g, (c) => ESC[c]);
}

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return escape(v);
}

function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Safe(out);
}

const raw = (s) => new Safe(String(s));

// JSON safe to embed inside <script type="application/json">.
function jsonScript(obj) {
  return raw(JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'));
}

function money(cents) {
  return '$' + (Number(cents || 0) / 100).toFixed(2);
}

module.exports = { html, raw, escape, jsonScript, money, Safe };
