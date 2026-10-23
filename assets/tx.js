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

  function initMenu() {
    var btn = document.querySelector('.tx-menu-btn');
    var header = document.querySelector('.tx-header');
    if (!btn || !header) return;
    btn.addEventListener('click', function () {
      var open = header.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
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
      var chg = q.changePct == null ? '' : fmtPct(q.changePct);
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

  function init() { initMenu(); initTicker(); }

  w.TX = { fmtPct: fmtPct, verdict: verdict, fetchSeasonality: fetchSeasonality, initMenu: initMenu, tickerHtml: tickerHtml, initTicker: initTicker, tickerSymbols: TICKER };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
