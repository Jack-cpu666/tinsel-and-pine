(function () {
  'use strict';
  var csrf = document.body.getAttribute('data-csrf') || '';

  // Confirmation prompts for destructive forms.
  document.addEventListener('submit', function (e) {
    var f = e.target;
    var btn = e.submitter;
    var msg = (btn && btn.getAttribute('data-confirm')) || f.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // Image uploads (multipart via fetch with CSRF header).
  Array.prototype.forEach.call(document.querySelectorAll('form[data-upload]'), function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var out = f.querySelector('[data-upload-msg]');
      var fd = new FormData(f);
      out.textContent = 'Uploading…';
      fetch(f.getAttribute('data-upload'), { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf, Accept: 'application/json' } })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Upload failed'); return j; }); })
        .then(function () { window.location.href = window.location.pathname + '?m=uploaded'; })
        .catch(function (err) { out.textContent = err.message; });
    });
  });

  // Copy shipping address.
  var copyBtn = document.querySelector('[data-copy-btn]');
  if (copyBtn) copyBtn.addEventListener('click', function () {
    var el = document.querySelector('[data-copy]');
    if (!el || !navigator.clipboard) return;
    navigator.clipboard.writeText(el.innerText).then(function () { copyBtn.textContent = 'Copied!'; });
  });
})();
