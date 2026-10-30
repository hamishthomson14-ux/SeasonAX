// Compare pages (/compare/<a>-vs-<b>): both assets' typical years (median of their last completed years) and their
// real paths this year, from /api/v1/seasonality?view=curve. Real prices only; an asset without enough history is named.
(function () {
  var COL = { a: '#F5A52F', b: '#4DA3FF' };
  var pct = function (v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%'; };
  var col = function (v) { return v > 0 ? 'var(--tx-up, #22c58b)' : v < 0 ? 'var(--tx-down, #f04f5f)' : 'var(--tx-text-3)'; };
  var AB = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var curve = function (id) { return fetch('/api/v1/seasonality?id=' + encodeURIComponent(id) + '&view=curve').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
  function init() {
    var box = document.getElementById('cmpYear'); if (!box || !window.TXYearCurve) return;
    var body = document.getElementById('cmpYearBody'), side = { a: { id: box.dataset.a, name: box.dataset.na }, b: { id: box.dataset.b, name: box.dataset.nb } };
    Promise.all([curve(side.a.id), curve(side.b.id)]).then(function (r) {
      side.a.d = r[0]; side.b.d = r[1];
      if (!r[0] && !r[1]) { body.innerHTML = '<p class="tx-muted">Not enough real daily price history to draw a typical year for either asset.</p>'; box.dataset.state = 'error'; return; }
      var lines = [], kpis = '', missing = [];
      ['a', 'b'].forEach(function (k) {
        var s = side[k], d = s.d;
        if (!d) { missing.push(s.name + ': not enough real daily history (we need at least 5 complete years, and never model one).'); return; }
        var cur = d.current || [], last = cur.length ? cur[cur.length - 1] : null, asOf = d.asOf ? new Date(d.asOf + 'T00:00:00Z') : null;
        lines.push({ key: 'typical-' + k, data: d.typical, color: COL[k], dashed: true }, { key: 'current-' + k, data: cur, color: COL[k] });
        kpis += '<div><span class="tx-label"><i class="c-dot" style="background:' + COL[k] + '"></i>' + s.name + ' · typical year</span><b data-yc="typical-' + k + '" style="color:' + col(d.typical[364]) + '">' + pct(d.typical[364]) + '</b><small data-yc="range-' + k + '">median of ' + d.n + ' years, ' + d.from + '–' + d.to + '</small></div>' +
          (last === null ? '' : '<div><span class="tx-label">' + s.name + ' · ' + d.year + ' so far</span><b data-yc="current-' + k + '" style="color:' + col(last) + '">' + pct(last) + '</b><small>to ' + asOf.getUTCDate() + ' ' + AB[asOf.getUTCMonth()] + '</small></div>');
      });
      var yr = (side.a.d || side.b.d).year;
      body.innerHTML = '<div class="hub-kpis">' + kpis + '</div>' +
        TXYearCurve.svg({ lines: lines, label: side.a.name + ' and ' + side.b.name + ': typical year (median) and ' + yr + ' so far' }) +
        '<p class="hub-legend">' + ['a', 'b'].filter(function (k) { return side[k].d; }).map(function (k) { return '<span><i style="background:' + COL[k] + '"></i>' + side[k].name + ': solid ' + yr + ', dashed typical</span>'; }).join('') + '</p>' +
        (missing.length ? '<p class="hub-note">' + missing.join(' ') + '</p>' : '') +
        '<p class="hub-note">Each year is measured from the previous year’s last close (daily closes, Yahoo Finance). Typical = the median of each asset’s completed years on each calendar day. History, not a forecast.</p>';
      box.dataset.state = 'done';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
