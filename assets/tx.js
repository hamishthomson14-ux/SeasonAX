/* TimingAX shared helpers — used by every page alongside /assets/tx.css. */
(function (w) {
  var MINUS = '−';

  function fmtPct(x, dp) {
    dp = dp == null ? 1 : dp;
    var s = Math.abs(x).toFixed(dp);
    if (Number(s) === 0) return s + '%';
    return (x > 0 ? '+' : MINUS) + s + '%';
  }

  // Same rule as api/seasonality/[id].js.
  function verdict(avg, win) {
    if (avg >= 0.8 && win >= 60) return 'TAILWIND';
    if (avg <= -0.5 && win <= 45) return 'HEADWIND';
    return 'NEUTRAL';
  }

  function fetchSeasonality(id) {
    try {
      return Promise.resolve(fetch('/api/v1/seasonality?id=' + encodeURIComponent(id)))
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .then(function (d) { return d && d.months ? d : null; })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  // Only verified (real price) data may be shown as an asset's figures; a modelled fallback
  // (source "modelled", observations null) is treated as unavailable.
  function fetchVerified(id) {
    return fetchSeasonality(id).then(function (d) { return d && d.source === 'verified' ? d : null; });
  }

  function initMenu() {
    var btn = document.querySelector('.tx-menu-btn');
    var header = document.querySelector('.tx-header');
    if (!btn || !header) return;
    var set = function (open) { header.classList.toggle('is-open', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
    btn.addEventListener('click', function () { set(!header.classList.contains('is-open')); });
    header.addEventListener('click', function (e) { if (e.target.closest('.tx-nav a, .tx-header__actions a')) set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && header.classList.contains('is-open')) { set(false); btn.focus(); } });
  }

  // Live ticker tape — real quotes from /api/prices, "—" when unavailable.
  // Yahoo-format symbols: the format /api/prices?quotes= answers.
  var TICKER = ['^GSPC', '^NDX', '^DJI', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META', 'GLD', 'BTC-USD', '^FTSE', '^GDAXI'];
  var TICKER_NAMES = { '^GSPC': 'S&P 500', '^NDX': 'NASDAQ 100', '^DJI': 'DOW', 'GLD': 'GOLD ETF', 'BTC-USD': 'BTC', '^FTSE': 'FTSE 100', '^GDAXI': 'DAX' };
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function tickerHtml(quotes) {
    var rows = quotes && quotes.length >= 4 ? quotes : TICKER.map(function (s) { return { symbol: s, close: null, changePct: null }; });
    return rows.map(function (q) {
      var nm = esc(TICKER_NAMES[q.symbol] || String(q.symbol).toUpperCase());
      var px = q.close == null ? '—' : q.close >= 1000 ? q.close.toLocaleString('en-US', { maximumFractionDigits: 0 }) : q.close.toFixed(2);
      var chg = q.changePct == null ? '' : fmtPct(q.changePct) + ' 5D'; // /api/prices quotes: change over its 5-day window
      var cls = q.changePct == null ? '' : q.changePct >= 0 ? 'tx-up' : 'tx-down';
      return '<span class="tx-ticker__item"><span class="tx-ticker__sym">' + nm + '</span><span class="tx-ticker__px">' + px +
        '</span>' + (chg ? '<span class="' + cls + '">' + chg + '</span>' : '') + '</span>';
    }).join('');
  }

  function initTicker() {
    var track = document.getElementById('ttrack');
    if (!track || track.getAttribute('data-ready')) return;
    track.setAttribute('data-ready', '1');
    var paint = function (q) { var h = tickerHtml(q); track.innerHTML = h + h; };
    paint(null);
    fetch('/api/prices?quotes=' + TICKER.map(encodeURIComponent).join(','))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.quotes && d.quotes.length >= 4) paint(d.quotes); })
      .catch(function () {});
  }

  // One figure from an /api/v1/seasonality body. spec: { month: 'Sep', field, dp } or
  // { months: 'Nov,Dec,…', field: 'mavg', dp }. field: avg | win | obs | pos (positive years) | mavg.
  function seasonalValue(d, spec) {
    if (!d || !d.months) return null;
    var by = {};
    d.months.forEach(function (m) { by[m.abbr] = m; });
    var dp = spec.dp == null ? 1 : +spec.dp;
    if (spec.field === 'mavg') {
      var ms = String(spec.months || '').split(',').map(function (x) { return by[x.trim()]; });
      if (!ms.length || ms.some(function (m) { return !m; })) return null;
      return fmtPct(ms.reduce(function (s, m) { return s + m.avgReturn; }, 0) / ms.length, dp);
    }
    var m = by[spec.month];
    if (!m) return null;
    if (spec.field === 'win') return m.winRate + '%';
    if (spec.field === 'obs') return String(m.observations);
    if (spec.field === 'pos') return String(Math.round(m.winRate * m.observations / 100));
    return fmtPct(m.avgReturn, dp);
  }

  // Refresh every [data-tx-fill] figure in prose from the API. The page ships with today's real
  // value as text (readable without JS); this keeps it current. On failure the text stays as shipped.
  function fillSeasonal(root) {
    var els = (root || document).querySelectorAll('[data-tx-fill][data-tx-sid]');
    var bySid = {};
    Array.prototype.forEach.call(els, function (e) { (bySid[e.getAttribute('data-tx-sid')] = bySid[e.getAttribute('data-tx-sid')] || []).push(e); });
    Object.keys(bySid).forEach(function (sid) {
      fetchVerified(sid).then(function (d) {
        if (!d) return; // keep the real figure the page shipped with
        bySid[sid].forEach(function (e) {
          var v = seasonalValue(d, { month: e.getAttribute('data-tx-month'), months: e.getAttribute('data-tx-months'),
            field: e.getAttribute('data-tx-field'), dp: e.getAttribute('data-tx-dp') });
          if (v != null) e.textContent = v;
        });
      });
    });
  }

  function init() { initMenu(); initTicker(); fillSeasonal(); }

  w.TX = { fmtPct: fmtPct, verdict: verdict, fetchSeasonality: fetchSeasonality, fetchVerified: fetchVerified, initMenu: initMenu, tickerHtml: tickerHtml, initTicker: initTicker, tickerSymbols: TICKER,
    seasonalValue: seasonalValue, fillSeasonal: fillSeasonal };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
