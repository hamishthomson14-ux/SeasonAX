// Asset hub on /seasonality/<id>: price history, typical year, out-of-sample check, month in review and month vs month.
// Every figure comes from /api/v1/seasonality (real prices only); nothing is computed from a model.
(function () {
  var MO = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var AB = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var $ = function (id) { return document.getElementById(id); };
  var pct = function (v) { return v === null || v === undefined ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%'; };
  var col = function (v) { return v > 0 ? 'var(--tx-up, #22c58b)' : v < 0 ? 'var(--tx-down, #f04f5f)' : 'var(--tx-text-3)'; };
  var price = function (v) { return v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }); };
  var cache = {};
  function get(q) {
    if (!cache[q]) cache[q] = fetch('/api/v1/seasonality?' + q).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (d) { if (!d) delete cache[q]; return d; });
    return cache[q];
  }
  function bar(attrs, label, v, maxAbs) {
    return '<div class="hub-bar" ' + attrs + '><span class="hub-bar__l">' + label + '</span><span class="hub-bar__t"><i style="width:' + (Math.abs(v) / maxAbs * 100).toFixed(0) + '%;background:' + col(v) + '"></i></span><span class="hub-bar__v" data-k="ret" style="color:' + col(v) + '">' + pct(v) + '</span></div>';
  }

  function history(id, name) {
    var box = $('hubHistory');
    return get('id=' + id + '&view=history').then(function (d) {
      if (!d) { box.innerHTML = '<p class="tx-muted">Price history is unavailable right now.</p>'; box.dataset.state = 'error'; return; }
      var pts = d.points, s = d.summary, W = 760, H = 240, P = 34;
      var vals = pts.map(function (p) { return p[1]; }), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      // Prices that span more than 20x (e.g. Tesla since 2010) are drawn on a log scale so earlier years stay readable.
      var log = hi / lo > 20, f = log ? Math.log : function (v) { return v; }, flo = f(lo), fhi = f(hi);
      var x = function (k) { return P + 18 + (W - 2 * P - 18) * k / (pts.length - 1); }, y = function (v) { return H - P - (H - 2 * P) * (f(v) - flo) / ((fhi - flo) || 1); };
      var ticks = [0, 1, 2, 3].map(function (k) { var t = flo + (fhi - flo) * k / 3; return log ? Math.exp(t) : t; });
      var grid = ticks.map(function (v) { var yy = y(v).toFixed(1); return '<line x1="' + (P + 18) + '" y1="' + yy + '" x2="' + (W - P) + '" y2="' + yy + '" stroke="#12203A"/><text data-tick x="' + (P + 12) + '" y="' + yy + '" font-size="10" fill="#6B819A" text-anchor="end" dominant-baseline="middle">' + (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(v >= 10 ? 1 : 2)) + '</text>'; }).join('');
      var path = pts.map(function (p, k) { return (k ? 'L' : 'M') + x(k).toFixed(1) + ' ' + y(p[1]).toFixed(1); }).join('');
      var ym = function (s) { return AB[+s.slice(5, 7) - 1] + ' ' + s.slice(0, 4); };
      box.innerHTML =
        '<div class="hub-kpis">' +
          '<div><span class="tx-label">Since ' + ym(s.from) + '</span><b data-hub="total" style="color:' + col(s.total) + '">' + pct(s.total) + '</b><small>total price change</small></div>' +
          '<div><span class="tx-label">Per year</span><b data-hub="cagr" style="color:' + col(s.cagr) + '">' + pct(s.cagr) + '</b><small>annualised</small></div>' +
          '<div><span class="tx-label">Highest month-end close</span><b>' + price(s.high.c) + '</b><small>' + ym(s.high.ym) + '</small></div>' +
          '<div><span class="tx-label">Lowest month-end close</span><b>' + price(s.low.c) + '</b><small>' + ym(s.low.ym) + '</small></div>' +
        '</div>' +
        '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" data-scale="' + (log ? 'log' : 'linear') + '" role="img" aria-label="' + name + ' monthly closing price, ' + ym(s.from) + ' to ' + ym(s.to) + (log ? ', log scale' : '') + '">' + grid +
          '<path d="' + path + '" pathLength="1" class="tx-line" fill="none" stroke="#E89318" stroke-width="2"/>' +
          '<text x="' + (P + 18) + '" y="' + (H - 10) + '" font-size="11" fill="#6B819A">' + ym(s.from) + '</text>' +
          '<text x="' + (W - P) + '" y="' + (H - 10) + '" font-size="11" fill="#6B819A" text-anchor="end">' + ym(s.to) + '</text>' +
        '</svg>' +
        '<p class="hub-note">Month-end closing prices from Yahoo Finance (adjusted closes where Yahoo provides them). The latest month is in progress.' + (log ? ' Log scale: equal vertical distances are equal percentage moves.' : '') + '</p>';
      box.dataset.state = 'done';
    });
  }

  // Typical year: the median path of the last completed years (shaded: the middle half of years) vs this year's real path.
  function yearCurve(id, name) {
    var box = $('hubYear'), body = $('hubYearBody');
    return get('id=' + id + '&view=curve').then(function (d) {
      if (!d) { body.innerHTML = '<p class="tx-muted">Not enough real daily price history to draw a typical year for ' + name + ' (we need at least 5 complete years, and never model one).</p>'; box.dataset.state = 'error'; return; }
      var cur = d.current || [];
      var asOf = d.asOf ? new Date(d.asOf + 'T00:00:00Z') : null, today = d.asOf ? TXYearCurve.slot(d.asOf) : null;
      var nowAt = cur.length ? cur[cur.length - 1] : null, dAsOf = asOf ? asOf.getUTCDate() + ' ' + AB[asOf.getUTCMonth()] : '';
      body.innerHTML =
        '<div class="hub-kpis">' +
          '<div><span class="tx-label">Typical full year</span><b data-yc="typical" style="color:' + col(d.typical[364]) + '">' + pct(d.typical[364]) + '</b><small>median of ' + d.n + ' years</small></div>' +
          '<div><span class="tx-label">Years that ended up</span><b data-yc="up">' + d.up + ' of ' + d.n + '</b><small>' + d.from + '–' + d.to + '</small></div>' +
          (nowAt === null ? '' :
          '<div><span class="tx-label">' + d.year + ' so far</span><b data-yc="current" style="color:' + col(nowAt) + '">' + pct(nowAt) + '</b><small>to ' + dAsOf + '</small></div>' +
          '<div><span class="tx-label">Typical by ' + dAsOf + '</span><b data-yc="typicalToday" style="color:' + col(d.typical[today]) + '">' + pct(d.typical[today]) + '</b><small>median path</small></div>') +
        '</div>' +
        TXYearCurve.svg({ label: name + ': median path of ' + d.from + ' to ' + d.to + ' versus ' + d.year + ' so far', band: { p25: d.p25, p75: d.p75 },
          lines: [{ key: 'typical', data: d.typical, color: '#6B819A', dashed: true }, { key: 'current', data: cur, color: '#E89318' }] }) +
        '<p class="hub-legend"><span><i style="background:#E89318"></i>' + d.year + ' (real)</span><span><i style="background:#6B819A"></i>Typical year (median ' + d.from + '–' + d.to + ')</span><span><i style="background:rgba(107,129,154,.35)"></i>Middle half of years</span></p>' +
        '<p class="hub-note">Each year is measured from the previous year’s last close, using daily closes from Yahoo Finance. The typical line is the median of the ' + d.n + ' years on each calendar day, not an average, so one extreme year cannot drag it. History, not a forecast.</p>';
      box.dataset.state = 'done';
    });
  }

  // Does the pattern hold? The 15 occurrences behind each published month vs the (up to 15) occurrences before them.
  // available:false means the asset is too young for the check (never modelled); a failed request is a passing outage.
  function hold(id, name) {
    var box = $('hubHold'), body = $('hubHoldBody'); if (!box) return Promise.resolve();
    return get('id=' + id + '&view=consistency').then(function (d) {
      if (d && d.available === false) { body.innerHTML = '<p class="tx-muted">Not enough real price history to check ' + name + ' out of sample: this needs at least 25 years of month-end closes (the 15 behind each published month and at least 10 before them), and we never model the earlier years.</p>'; box.dataset.state = 'none'; return; }
      if (!d) { body.innerHTML = '<p class="tx-muted">The out-of-sample check is unavailable right now.</p>'; box.dataset.state = 'error'; return; }
      body.innerHTML = TXConsistency.html(d, { name: name });
      box.dataset.state = 'done';
    });
  }

  function monthReview(id, name) {
    var box = $('hubMonth'), sel = $('hubMonthSel'), my = 0;
    function load() {
      var m = +sel.value, me = ++my;
      box.dataset.state = 'loading'; box.dataset.key = '';
      get('id=' + id + '&view=month&month=' + (m + 1) + '&years=20').then(function (d) {
        if (me !== my) return;
        box.dataset.key = String(m);
        var out = $('hubMonthBody');
        if (!d) { $('hubMonthSummary').textContent = 'No real price history for this month.'; out.innerHTML = ''; box.dataset.state = 'error'; return; }
        var s = d.summary, last = d.years[0];
        $('hubMonthSummary').textContent = name + ' rose in ' + s.up + ' of the last ' + s.n + ' ' + MO[m] + 's (' + s.from + '–' + last.year + (last.partial ? ', counting this ' + MO[m] + ' so far' : '') + '), averaging ' + pct(s.avg) + '. Best: ' + s.best.year + ' ' + pct(s.best.ret) + '. Worst: ' + s.worst.year + ' ' + pct(s.worst.ret) + '.';
        var mx = Math.max.apply(null, d.years.map(function (y) { return Math.abs(y.ret); }).concat([0.01]));
        var days = d.days.up.concat(d.days.down), mxd = Math.max.apply(null, days.map(function (x) { return Math.abs(x.ret); }).concat([0.01]));
        out.innerHTML = '<div class="hub-col"><h3 class="tx-label">Every ' + MO[m] + '</h3>' +
          d.years.map(function (y) { return bar('data-year="' + y.year + '"', y.year + (y.partial ? ' (so far)' : ''), y.ret, mx); }).join('') + '</div>' +
          '<div class="hub-col"><h3 class="tx-label">Biggest daily moves in ' + MO[m] + '</h3>' +
          (days.length ? days.map(function (x) { var t = new Date(x.date + 'T00:00:00Z'); return bar('data-date="' + x.date + '"', t.getUTCDate() + ' ' + AB[t.getUTCMonth()] + ' ' + t.getUTCFullYear(), x.ret, mxd); }).join('') : '<p class="tx-muted">No daily price history for this window.</p>') + '</div>';
        var link = $('hubMonthLink'); if (link) { link.href = '/seasonality/' + id + '/' + MO[m].toLowerCase(); link.textContent = 'Open the full ' + name + ' in ' + MO[m] + ' page \u2192'; }
        box.dataset.state = 'done';
      });
    }
    sel.addEventListener('change', load);
    load();
  }

  function monthVsMonth(id) {
    var box = $('hubVs'), a = $('hubVsA'), b = $('hubVsB'), my = 0;
    function load() {
      var ma = +a.value, mb = +b.value, me = ++my;
      box.dataset.state = 'loading'; box.dataset.key = '';
      Promise.all([get('id=' + id + '&view=month&month=' + (ma + 1) + '&years=20'), get('id=' + id + '&view=month&month=' + (mb + 1) + '&years=20')]).then(function (r) {
        if (me !== my) return;
        box.dataset.key = ma + ':' + mb;
        var tb = box.querySelector('tbody');
        if (!r[0] || !r[1]) { $('hubVsSummary').textContent = 'No real price history for these months.'; tb.innerHTML = ''; box.dataset.state = 'error'; return; }
        var bm = {}; r[1].years.forEach(function (y) { bm[y.year] = y.ret; });
        var both = r[0].years.filter(function (y) { return bm[y.year] !== undefined; });
        var aw = both.filter(function (y) { return y.ret > bm[y.year]; }).length, bw = both.filter(function (y) { return bm[y.year] > y.ret; }).length;
        var avg = function (arr) { return arr.length ? Math.round(arr.reduce(function (s, v) { return s + v; }, 0) / arr.length * 100) / 100 : null; };
        $('hubVsSummary').textContent = ma === mb ? 'Pick two different months.' :
          'Over the ' + both.length + ' years with both months on record, ' + MO[ma] + ' did better in ' + aw + ' and ' + MO[mb] + ' did better in ' + bw + ' of ' + both.length + ' years. Averages: ' + MO[ma] + ' ' + pct(avg(both.map(function (y) { return y.ret; }))) + ', ' + MO[mb] + ' ' + pct(avg(both.map(function (y) { return bm[y.year]; }))) + '.';
        box.querySelector('thead').innerHTML = '<tr><th>Year</th><th class="r">' + MO[ma] + '</th><th class="r">' + MO[mb] + '</th><th class="r">Better</th></tr>';
        tb.innerHTML = both.map(function (y) {
          var v = bm[y.year], w = y.ret > v ? AB[ma] : v > y.ret ? AB[mb] : 'Tie';
          return '<tr data-year="' + y.year + '"><td>' + y.year + (y.partial || r[1].years.some(function (z) { return z.year === y.year && z.partial; }) ? ' <small class="tx-muted">(so far)</small>' : '') + '</td>' +
            '<td class="r tx-num" data-k="a" style="color:' + col(y.ret) + '">' + pct(y.ret) + '</td><td class="r tx-num" data-k="b" style="color:' + col(v) + '">' + pct(v) + '</td><td class="r">' + w + '</td></tr>';
        }).join('');
        box.dataset.state = 'done';
      });
    }
    a.addEventListener('change', load); b.addEventListener('change', load);
    load();
  }

  function init() {
    var hub = $('hub'); if (!hub) return;
    var id = hub.dataset.id, name = hub.dataset.name, cm = new Date().getUTCMonth();
    var opts = MO.map(function (m, k) { return '<option value="' + k + '">' + m + '</option>'; }).join('');
    $('hubMonthSel').innerHTML = opts; $('hubMonthSel').value = String(cm);
    $('hubVsA').innerHTML = opts; $('hubVsB').innerHTML = opts;
    $('hubVsA').value = String(cm); $('hubVsB').value = String((cm + 1) % 12);
    hub.dataset.state = 'loading';
    Promise.all([history(id, name), yearCurve(id, name), hold(id, name)]).then(function () { hub.dataset.state = 'done'; });
    monthReview(id, name);
    monthVsMonth(id);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
