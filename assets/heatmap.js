/* TimingAX year × month returns heatmap. One renderer for the asset pages (imported server-side) and the analyzer
   (loaded in the browser): globalThis.TXHeatmap.html(grid, opts) -> HTML string.
   grid: { years: [{ year, cells: [{ ret, inAvg, partial?, flag? } | null] x12, total, totalPartial? }], months: [{ avg, win, n }] x12, window } */
(function (root) {
  var AB = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var pct = function (v) { return Math.abs(v) < 0.05 ? '0.0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1); };   // no signed zero
  // Colour strength scales with the move against this asset's own typical month, capped so one outlier can't wash out the rest.
  function shade(v, cap) { var a = Math.min(Math.abs(v) / cap, 1); return v >= 0 ? 'rgba(34,197,139,' + (0.12 + 0.6 * a).toFixed(2) + ')' : 'rgba(240,79,95,' + (0.12 + 0.6 * a).toFixed(2) + ')'; }
  function html(g, o) {
    o = o || {};
    var all = []; g.years.forEach(function (y) { y.cells.forEach(function (c) { if (c && !c.flag) all.push(Math.abs(c.ret)); }); });
    all.sort(function (a, b) { return a - b; });
    var cap = all.length ? all[Math.floor(all.length * 0.9)] || 1 : 1;
    var head = '<tr><th scope="col">Year</th>' + AB.map(function (m) { return '<th scope="col">' + m + '</th>'; }).join('') + '<th scope="col">Year</th></tr>';
    var body = g.years.map(function (y) {
      return '<tr data-year="' + y.year + '"><th scope="row">' + y.year + '</th>' + y.cells.map(function (c, m) {
        if (!c) return '<td data-m="' + m + '" class="hm-empty"></td>';
        var title = AB[m] + ' ' + y.year + ': ' + pct(c.ret) + '%' + (c.partial ? ' so far (month in progress)' : '') + (c.flag ? ' (over 95%: treated as a data error, not averaged)' : !c.inAvg ? ' (outside the ' + g.window + '-year average)' : '');
        return '<td data-m="' + m + '"' + (c.inAvg ? '' : ' data-out') + (c.partial ? ' data-partial' : '') + ' style="background:' + (c.flag ? 'transparent' : shade(c.ret, cap)) + '" title="' + title + '">' + pct(c.ret) + '</td>';
      }).join('') + '<td data-total' + (y.totalPartial ? ' data-partial' : '') + (y.total == null ? '' : ' title="' + y.year + (y.totalPartial ? ' so far' : ', December to December') + '"') + '>' + (y.total == null ? '' : pct(y.total)) + '</td></tr>';
    }).join('');
    var foot = g.months ? '<tfoot><tr><th scope="row">Avg</th>' + g.months.map(function (x, m) { return '<td data-m="' + m + '">' + pct(x.avg) + '</td>'; }).join('') + '<td></td></tr>' +
      '<tr><th scope="row">Up</th>' + g.months.map(function (x, m) { return '<td data-m="' + m + '">' + x.win + '%</td>'; }).join('') + '<td></td></tr></tfoot>' : '';
    return '<div class="hm-scroll"><table class="hm"' + (o.state ? ' data-state="' + o.state + '"' : '') + ' aria-label="' + (o.name ? o.name + ': ' : '') + 'monthly returns by year, %"><thead>' + head + '</thead><tbody>' + body + '</tbody>' + foot + '</table></div>' +
      '<p class="hm-note">Each cell is that month’s real return (last close vs the previous month’s last close), in %. Avg and Up use the last ' + g.window + ' completed occurrences of each month; faded cells fall outside that window; outlined cells are the month in progress. The right-hand column is the calendar year (this year: so far).</p>';
  }
  root.TXHeatmap = { html: html };
})(typeof window !== 'undefined' ? window : globalThis);
