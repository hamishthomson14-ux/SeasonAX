/* TimingAX seasonal projection — next 30/60/90 days drawn from real history (Pro).
   Data: /api/v1/seasonality?id=<id>&view=projection&days=<n>. Never shows modelled numbers. */
(function (w) {
  var MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MINUS = '−';
  function pct(v) { return (v >= 0 ? '+' : MINUS) + Math.abs(v).toFixed(1) + '%'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function dayLabel(isoDate, k) { var d = new Date(Date.parse(isoDate + 'T00:00:00Z') + k * 864e5); return d.getUTCDate() + ' ' + MO[d.getUTCMonth()]; }
  function num(v) { return v >= 1000 ? Math.round(v).toLocaleString('en-US') : v >= 10 ? v.toFixed(2) : v.toFixed(4); }

  // Pure: SVG for a projection body (prices = latest close x (1 + path%)).
  function svg(p, opts) {
    opts = opts || {};
    var W = opts.width || 760, H = opts.height || 300, pl = 62, pr = 18, pt = 16, pb = 30, n = p.days;
    var P0 = p.start.price, lev = function (v) { return P0 * (1 + v / 100); };
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i <= n; i++) { lo = Math.min(lo, lev(p.min[i])); hi = Math.max(hi, lev(p.max[i])); }
    var pad = (hi - lo) * 0.06 || P0 * 0.01; lo -= pad; hi += pad;
    var X = function (k) { return pl + (W - pl - pr) * k / n; };
    var Y = function (v) { return pt + (H - pt - pb) * (hi - lev(v)) / (hi - lo); };
    var line = function (a) { var s = ''; for (var k = 0; k <= n; k++) s += (k ? 'L' : 'M') + X(k).toFixed(1) + ',' + Y(a[k]).toFixed(1); return s; };
    var band = function (a, b) { var s = line(a); for (var k = n; k >= 0; k--) s += 'L' + X(k).toFixed(1) + ',' + Y(b[k]).toFixed(1); return s + 'Z'; };
    // ~5 horizontal gridlines at a round step
    var raw = (hi - lo) / 5, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; }).filter(function (s) { return s >= raw; })[0];
    var grid = '';
    for (var g = Math.ceil(lo / step) * step; g < hi; g += step) {
      var gy = pt + (H - pt - pb) * (hi - g) / (hi - lo);
      grid += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '" stroke="#15223A"/>' +
        '<text x="' + (pl - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="#8296AD" font-family="IBM Plex Mono,monospace">' + num(g) + '</text>';
    }
    var ticks = [0, Math.round(n / 3), Math.round(2 * n / 3), n], xl = '';
    ticks.forEach(function (k, j) {
      xl += '<text x="' + X(k).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="' + (j === 0 ? 'start' : j === 3 ? 'end' : 'middle') + '" font-size="11" fill="#8296AD" font-family="IBM Plex Mono,monospace">' + dayLabel(p.from || p.start.date, k) + '</text>';
    });
    var end = lev(p.median[n]);
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Seasonal projection: typical path ' + pct(p.median[n]) + ' over ' + n + ' days">' + grid +
      '<path d="' + band(p.max, p.min) + '" fill="rgba(77,163,255,.10)"/>' +
      '<path d="' + band(p.p75, p.p25) + '" fill="rgba(232,147,24,.20)"/>' +
      '<path class="proj-median" d="' + line(p.median) + '" fill="none" stroke="#F5A52F" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<circle cx="' + X(0).toFixed(1) + '" cy="' + Y(0).toFixed(1) + '" r="5" fill="#EDF2FA"/>' +
      '<circle cx="' + X(n).toFixed(1) + '" cy="' + Y(p.median[n]).toFixed(1) + '" r="4" fill="#F5A52F"/>' +
      '<text x="' + (X(n) - 6).toFixed(1) + '" y="' + (Y(p.median[n]) - 10).toFixed(1) + '" text-anchor="end" font-size="12" fill="#F5A52F" font-family="IBM Plex Mono,monospace">' + num(end) + '</text>' +
      xl + '</svg>';
  }

  // Decorative locked preview: a generic shape, no data, no numbers.
  var LOCKED_SVG = '<svg viewBox="0 0 760 300" width="100%" aria-hidden="true"><path d="M62,170 C200,150 300,120 420,128 S620,90 742,70 L742,40 C620,60 520,80 420,96 S200,120 62,150Z" fill="rgba(232,147,24,.25)"/>' +
    '<path d="M62,160 C200,140 300,110 420,112 S620,80 742,55" fill="none" stroke="#F5A52F" stroke-width="3"/></svg>';

  function shell(name, statusHtml, inner) {
    return '<div class="tx-term proj">' +
      '<div class="tx-term__head"><span class="tx-term__title">' + esc(name) + ' · Seasonal projection</span><span class="tx-term__status">' + statusHtml + '</span></div>' + inner + '</div>';
  }

  function mount(el, o) {
    if (!el) return;
    el.hidden = false;
    if (!o.pro) {
      el.innerHTML = shell(o.name, 'Pro',
        '<div class="proj-locked"><div class="proj-blur">' + LOCKED_SVG + '</div><div class="proj-cta">' +
        '<span class="tx-badge tx-badge--now">🔒 Pro</span>' +
        '<b>Where has ' + esc(o.name) + ' typically gone from here?</b>' +
        '<span>See the next 30, 60 or 90 days, drawn from up to 15 years of real price history.</span>' +
        '<button type="button" class="tx-btn tx-btn--primary">' + esc(o.cta || 'Unlock with Pro') + '</button></div></div>');
      el.querySelector('.tx-btn--primary').addEventListener('click', function () { if (o.onUpgrade) o.onUpgrade(); });
      return;
    }
    var days = 90, token = 0;
    function render() {
      var my = ++token;
      var toggles = [30, 60, 90].map(function (d) { return '<button type="button" class="proj-day' + (d === days ? ' is-on' : '') + '" data-days="' + d + '" aria-pressed="' + (d === days) + '">' + d + 'D</button>'; }).join('');
      el.innerHTML = shell(o.name, 'Loading', '<div class="proj-days" role="group" aria-label="Projection length">' + toggles + '</div><div class="proj-body"><span class="tx-skel" style="display:block;height:220px;margin:16px"></span></div>');
      el.querySelectorAll('.proj-day').forEach(function (b) { b.addEventListener('click', function () { days = +b.getAttribute('data-days'); render(); var nb = el.querySelector('[data-days="' + days + '"]'); if (nb) nb.focus(); }); });
      fetch('/api/v1/seasonality?id=' + encodeURIComponent(o.id) + '&view=projection&days=' + days)
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (p) {
          if (my !== token) return;
          var status = el.querySelector('.tx-term__status'), body = el.querySelector('.proj-body');
          if (!p || p.source !== 'verified' || !p.median) {
            status.textContent = 'Unavailable';
            body.innerHTML = '<p class="proj-na">Projection not available for ' + esc(o.name) + ': it needs real daily price history, and we never show a modelled one.</p>';
            return;
          }
          status.className = 'tx-term__status is-live'; status.textContent = 'Pro · ' + p.n + 'Y real data';
          var k = days;
          body.innerHTML = '<div class="proj-chart">' + svg(p) + '</div>' +
            '<div class="proj-kpis">' +
            '<div><b class="' + (p.median[k] >= 0 ? 'tx-up' : 'tx-down') + '" data-proj="typical">' + pct(p.median[k]) + '</b><span class="tx-label">Typical path · ' + dayLabel(p.from || p.start.date, k) + '</span></div>' +
            '<div><b data-proj="up">' + p.up + ' of ' + p.n + '</b><span class="tx-label">Years higher</span></div>' +
            '<div><b data-proj="band">' + pct(p.p25[k]) + ' to ' + pct(p.p75[k]) + '</b><span class="tx-label">Middle half of years</span></div>' +
            '<div><b data-proj="range"><span class="tx-down">' + pct(p.min[k]) + '</span> / <span class="tx-up">' + pct(p.max[k]) + '</span></b><span class="tx-label">Worst / best year</span></div>' +
            '</div>' +
            '<div class="tx-term__foot"><span><i class="proj-key proj-key--m"></i>typical path <i class="proj-key proj-key--b"></i>middle half <i class="proj-key proj-key--r"></i>full range</span><span>From the ' + dayLabel(p.start.date, 0) + ' close ' + num(p.start.price) + '</span></div>' +
            '<p class="tx-note proj-note">How ' + esc(o.name) + ' moved over these same ' + k + ' days in each of the last ' + p.n + ' years, applied to the latest close. A historical pattern, not a forecast.</p>';
        });
    }
    render();
  }

  w.TXProjection = { svg: svg, mount: mount, LOCKED_SVG: LOCKED_SVG };
})(window);
