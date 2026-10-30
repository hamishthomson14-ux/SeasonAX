/* TimingAX calendar-year chart: % paths on 365 day-of-year slots (from /api/v1/seasonality?view=curve).
   Shared by the asset hub (typical year vs this year) and compare pages (two assets overlaid).
   TXYearCurve.svg({ lines: [{ key, data, color, dashed?, width? }], band?: { p25, p75 }, label }) -> SVG string. */
(function (root) {
  var AB = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var SLOT0 = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  function slot(iso) { var m = +iso.slice(5, 7) - 1; return SLOT0[m] + Math.min(+iso.slice(8, 10), m === 1 ? 28 : 31) - 1; }
  function svg(o) {
    var W = 760, H = 260, L = 52, R = 14, T = 14, B = 30, lines = o.lines || [], band = o.band;
    var all = [0]; lines.forEach(function (l) { all = all.concat(l.data); }); if (band) all = all.concat(band.p25, band.p75);
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    var x = function (k) { return L + (W - L - R) * k / 364; }, y = function (v) { return T + (H - T - B) * (hi - v) / ((hi - lo) || 1); };
    var path = function (a) { return a.map(function (v, k) { return (k ? 'L' : 'M') + x(k).toFixed(1) + ' ' + y(v).toFixed(1); }).join(''); };
    var step = Math.pow(10, Math.floor(Math.log(Math.max(hi - lo, 1) / 4) / Math.LN10)), tick = [1, 2, 5, 10].map(function (m) { return m * step; }).filter(function (t) { return (hi - lo) / t <= 6; })[0];
    var out = '';
    for (var v = Math.ceil(lo / tick) * tick; v <= hi + 1e-9; v += tick) { var yy = y(v).toFixed(1); out += '<line x1="' + L + '" y1="' + yy + '" x2="' + (W - R) + '" y2="' + yy + '" stroke="' + (Math.abs(v) < 1e-9 ? '#2A3B57' : '#12203A') + '"/><text data-tick x="' + (L - 6) + '" y="' + yy + '" font-size="10" fill="#6B819A" text-anchor="end" dominant-baseline="middle">' + (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(+v.toFixed(6)) + '%</text>'; }
    out += SLOT0.map(function (s, k) { return '<text x="' + x(s + 15).toFixed(1) + '" y="' + (H - 10) + '" font-size="10" fill="#6B819A" text-anchor="middle">' + AB[k] + '</text>'; }).join('');
    if (band) out += '<path data-line="band" d="' + path(band.p75) + band.p25.slice().reverse().map(function (v, k) { return 'L' + x(364 - k).toFixed(1) + ' ' + y(v).toFixed(1); }).join('') + 'Z" fill="rgba(107,129,154,.16)" stroke="none"/>';
    lines.forEach(function (l) {
      if (!l.data || !l.data.length) return;
      out += '<path data-line="' + l.key + '" d="' + path(l.data) + '"' + (l.dashed ? '' : ' pathLength="1" class="tx-line"') + ' fill="none" stroke="' + l.color + '" stroke-width="' + (l.width || (l.dashed ? 1.6 : 2.2)) + '"' + (l.dashed ? ' stroke-dasharray="4 3"' : '') + '/>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + (o.label || '') + '">' + out + '</svg>';
  }
  root.TXYearCurve = { svg: svg, slot: slot };
})(typeof window !== 'undefined' ? window : globalThis);
