/* TimingAX "Does the pattern hold?" panel. One renderer for the asset pages and the analyzer (both load it in the
   browser): globalThis.TXConsistency.html(d, opts) -> HTML string, d = /api/v1/seasonality?view=consistency.
   d: { years, recent: { from, to, n }, prior: { from, to, n }, months: [{ m, recent: { avg, win, n }, prior: { avg, win, n }, agree }] x12,
       agree, rankCorr, best: { recent, prior }, worst: { recent, prior } } */
(function (root) {
  var AB = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var pct = function (v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%'; };
  var col = function (v) { return v > 0 ? 'var(--tx-up, #22c58b)' : v < 0 ? 'var(--tx-down, #f04f5f)' : 'var(--tx-text-3)'; };
  var ym = function (s) { return AB[+s.slice(5, 7) - 1] + ' ' + s.slice(0, 4); };
  function html(d, o) {
    o = o || {};
    var span = function (w) { return ym(w.from) + ' – ' + ym(w.to); };
    var rc = d.rankCorr, pmax = Math.max.apply(null, d.months.map(function (x) { return x.prior.n; }));
    var kpis = '<div class="hub-kpis">' +
      '<div><span class="tx-label">Months pointing the same way</span><b data-cs="agree">' + d.agree + ' of 12</b><small>recent vs earlier window</small></div>' +
      '<div><span class="tx-label">Order of the months</span><b data-cs="rank" style="color:' + col(rc) + '">' + (rc === null ? '—' : (rc >= 0 ? '+' : '−') + Math.abs(rc).toFixed(2)) + '</b><small>rank correlation, −1 to +1</small></div>' +
      '<div><span class="tx-label">Best month</span><b data-cs="best">' + d.best.recent + ' · ' + d.best.prior + '</b><small>recent · earlier</small></div>' +
      '<div><span class="tx-label">Worst month</span><b data-cs="worst">' + d.worst.recent + ' · ' + d.worst.prior + '</b><small>recent · earlier</small></div>' +
      '</div>';
    var head = '<tr><th scope="col">Month</th><th scope="col" class="r" colspan="2">' + span(d.recent) + '</th><th scope="col" class="r" colspan="2">' + span(d.prior) + '</th><th scope="col" class="r">Same way</th></tr>' +
      '<tr><th></th><th class="r">Avg</th><th class="r" title="Share of years the month ended up">Up</th><th class="r">Avg</th><th class="r" title="Share of years the month ended up">Up</th><th></th></tr>';
    var body = d.months.map(function (x, m) {
      return '<tr data-m="' + m + '"' + (x.agree ? ' data-agree' : '') + '><th scope="row">' + x.m + '</th>' +
        '<td class="r tx-num" data-k="ra" style="color:' + col(x.recent.avg) + '">' + pct(x.recent.avg) + '</td><td class="r tx-num" data-k="rw">' + x.recent.win + '%</td>' +
        '<td class="r tx-num" data-k="pa" style="color:' + col(x.prior.avg) + '">' + pct(x.prior.avg) + '</td><td class="r tx-num" data-k="pw">' + x.prior.win + '%</td>' +
        '<td class="r cs-same" data-k="same" title="' + (x.agree ? 'Same direction in both windows' : 'Opposite directions') + '">' + (x.agree ? '✓' : '✗') + '</td></tr>';
    }).join('');
    return kpis + '<div class="hub-scroll"><table class="tx-table cs"' + (o.state ? ' data-state="' + o.state + '"' : '') + ' aria-label="' + (o.name ? o.name + ': ' : '') + 'monthly averages in two windows that share no month"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="hub-note">Two windows that share no month: the last ' + d.years + ' completed occurrences of each month (the ones behind the published average) and the ' + (d.prior.n === pmax ? d.prior.n : d.prior.n + '–' + pmax) + ' before them. A month points the same way when its average return has the same sign in both. Rank correlation compares the order of the 12 months (+1: the same order, 0: unrelated, −1: reversed). Agreement is evidence that a pattern persisted; it is not a forecast. Month-end closes from Yahoo Finance, adjusted where provided.</p>';
  }
  root.TXConsistency = { html: html };
})(typeof window !== 'undefined' ? window : globalThis);
