// cookie-consent.js
// A simple, honest cookie/storage notice for TimingAX.
//
// TimingAX does NOT use advertising or third-party tracking cookies.
// The only storage in use is:
//   - Supabase auth cookie (strictly necessary - keeps you logged in)
//   - localStorage for watchlist, portfolio, and free-tier usage count
//     (functional - stays on your device, only syncs if you're logged in)
//
// Because there's nothing non-essential to opt in/out of, this is an
// informational notice rather than an accept/reject gate.
//
// ANALYTICS: We use Cloudflare Web Analytics, which is COOKIELESS and
// privacy-first - it sets no cookies, stores nothing on the visitor's
// device, and collects no personal data or cross-site identifiers. This
// is why it does not require a consent gate and does not contradict our
// privacy policy (no Google Analytics, no tracking cookies, no ad trackers).
// To activate: create a free Cloudflare Web Analytics site in your
// Cloudflare dashboard and paste the generated token below.

(function () {
  // ── Cloudflare Web Analytics (cookieless) ──
  var CF_TOKEN = '4fc389ba53334f75a1b1ed5a2df87b50';
  if (CF_TOKEN && CF_TOKEN.indexOf('REPLACE_WITH') === -1) {
    var cf = document.createElement('script');
    cf.defer = true;
    cf.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    cf.setAttribute('data-cf-beacon', JSON.stringify({ token: CF_TOKEN }));
    document.head.appendChild(cf);
  }
})();

(function () {
  var KEY = 'sx_cookie_notice_seen';
  try {
    if (localStorage.getItem(KEY)) return;
  } catch (e) {
    return; // localStorage unavailable - don't show a banner we can't dismiss
  }

  var style = document.createElement('style');
  style.textContent = `
    .ck-banner{position:fixed;left:16px;right:16px;bottom:16px;max-width:560px;margin:0 auto;
      background:#0B1120;border:1px solid #162540;border-radius:12px;padding:16px 18px;
      box-shadow:0 12px 40px rgba(0,0,0,.5);z-index:9999;
      font-family:Inter,-apple-system,sans-serif;color:#C4D0DF;font-size:13px;line-height:1.6;
      display:flex;flex-direction:column;gap:12px;animation:ckIn .3s ease-out}
    @keyframes ckIn{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
    .ck-banner a{color:#F5A52F;text-decoration:underline;text-decoration-color:rgba(232,147,24,.3)}
    .ck-actions{display:flex;gap:10px;justify-content:flex-end}
    .ck-btn{font:600 12px/1 Inter,sans-serif;border-radius:6px;padding:8px 16px;cursor:pointer;border:1px solid #162540;background:transparent;color:#8FA3B8;transition:all .15s}
    .ck-btn.primary{background:#E89318;color:#04070F;border-color:#E89318}
    .ck-btn:hover{border-color:#F5A52F}
    @media(max-width:480px){.ck-banner{left:10px;right:10px;bottom:10px;padding:14px}}
  `;
  document.head.appendChild(style);

  var banner = document.createElement('div');
  banner.className = 'ck-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Cookie notice');
  banner.innerHTML =
    '<div>We use only essential cookies (to keep you logged in) and local storage on your device ' +
    '(to remember your watchlist, portfolio, and free-tier usage). No advertising or tracking cookies. ' +
    '<a href="/privacy-policy.html#cookies">Learn more</a>.</div>' +
    '<div class="ck-actions"><button class="ck-btn primary" id="ckOk">Got it</button></div>';

  document.body.appendChild(banner);

  document.getElementById('ckOk').addEventListener('click', function () {
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
    banner.remove();
  });
})();
