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

  // One shared request per id per page; a failed result is dropped so a later call can retry.
  var inflight = {};
  function fetchSeasonality(id) {
    if (inflight[id]) return inflight[id];
    var p;
    try {
      p = Promise.resolve(fetch('/api/v1/seasonality?id=' + encodeURIComponent(id)))
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .then(function (d) { return d && d.months ? d : null; })
        .catch(function () { return null; });
    } catch (e) { p = Promise.resolve(null); }
    inflight[id] = p;
    p.then(function (d) { if (!d) delete inflight[id]; });
    return p;
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

  // Header search: match the catalogue by ticker or name, open /seasonality/<id>.
  var catPromise = null;
  function catalogue() {
    if (!catPromise) catPromise = fetch('/api/catalogue').then(function (r) { return r.ok ? r.json() : []; }).catch(function () { catPromise = null; return []; });
    return catPromise;
  }
  function rank(cat, q) {
    q = q.trim().toLowerCase(); if (!q) return [];
    var out = [];
    cat.forEach(function (a) {
      var t = String(a.ticker || '').toLowerCase().replace(/^\^/, ''), n = String(a.name || '').toLowerCase(), id = a.id, s = -1;
      if (t === q || id === q) s = 0;
      else if (n === q) s = 1;
      else if (t.indexOf(q) === 0 || id.indexOf(q) === 0) s = 2;
      else if (n.indexOf(q) === 0) s = 3;
      else if ((' ' + n).indexOf(' ' + q) >= 0) s = 4;
      else if (n.indexOf(q) >= 0 || t.indexOf(q) >= 0) s = 5;
      if (s >= 0) out.push({ a: a, s: s });
    });
    out.sort(function (x, y) { return x.s - y.s || x.a.name.length - y.a.name.length || (x.a.name < y.a.name ? -1 : 1); });
    return out.slice(0, 8).map(function (x) { return x.a; });
  }
  function initSearch() {
    var input = document.getElementById('txSearch'), list = document.getElementById('txSearchList');
    if (!input || !list) return;
    var items = [], sel = -1, token = 0;
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); sel = -1; }
    function mark() {
      [].forEach.call(list.children, function (li, k) { li.setAttribute('aria-selected', k === sel ? 'true' : 'false'); });
      if (sel >= 0) input.setAttribute('aria-activedescendant', 'txs-' + sel); else input.removeAttribute('aria-activedescendant');
    }
    function go(a) { location.href = a ? '/seasonality/' + encodeURIComponent(a.id) : '/seasonality.html?q=' + encodeURIComponent(input.value.trim()); }
    function render() {
      var my = ++token, q = input.value;
      catalogue().then(function (cat) {
        if (my !== token) return;
        items = rank(cat, q); sel = -1;
        if (!q.trim()) { list.innerHTML = ''; close(); return; }
        list.innerHTML = items.map(function (a, k) {
          return '<li id="txs-' + k + '" role="option" aria-selected="false" data-id="' + esc(a.id) + '">' + esc(a.name) + '<span>' + esc(String(a.ticker).replace(/^\^/, '')) + '</span></li>';
        }).join('') + (items.length ? '' : '<li class="tx-search__all" role="presentation">No match &mdash; press Enter to search all assets</li>');
        list.hidden = false; input.setAttribute('aria-expanded', items.length ? 'true' : 'false');
      });
    }
    input.addEventListener('input', render);
    input.addEventListener('focus', function () { catalogue(); if (input.value.trim()) render(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); mark(); }
      else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
      else if (e.key === 'Escape') { close(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (!input.value.trim()) return; catalogue().then(function (cat) { if (!items.length) items = rank(cat, input.value); go(items[sel >= 0 ? sel : 0]); }); }
    });
    list.addEventListener('mousedown', function (e) { var li = e.target.closest('[role="option"]'); if (li) { e.preventDefault(); go(items.filter(function (a) { return a.id === li.dataset.id; })[0]); } });
    document.addEventListener('click', function (e) { if (!e.target.closest('.tx-search')) close(); });
  }

  function init() { initMenu(); initTicker(); fillSeasonal(); initSearch(); }

  w.TX = { fmtPct: fmtPct, verdict: verdict, fetchSeasonality: fetchSeasonality, fetchVerified: fetchVerified, initMenu: initMenu, tickerHtml: tickerHtml, initTicker: initTicker, tickerSymbols: TICKER,
    seasonalValue: seasonalValue, fillSeasonal: fillSeasonal };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
