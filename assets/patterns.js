/* TimingAX weekly + turn-of-month patterns (Pro) — /api/v1/seasonality?id=<id>&view=patterns.
   Real daily prices only; never modelled. */
(function (w) {
  var MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function pct(v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  // Monday of ISO week `wk` in `year` (UTC ms).
  function weekMonday(year, wk) {
    var jan4 = Date.UTC(year, 0, 4), dow = (new Date(jan4).getUTCDay() + 6) % 7;
    return jan4 - dow * 864e5 + (wk - 1) * 7 * 864e5;
  }
  function weekLabel(wk) {
    var y = new Date().getUTCFullYear(), m = weekMonday(y, wk), f = new Date(m + 4 * 864e5), s = new Date(m);
    return s.getUTCDate() + (s.getUTCMonth() === f.getUTCMonth() ? '' : ' ' + MO[s.getUTCMonth()]) + '–' + f.getUTCDate() + ' ' + MO[f.getUTCMonth()];
  }
  function currentWeek() {
    var t = Date.now(), d = new Date(t), day = (d.getUTCDay() + 6) % 7;
    var th = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3), y = new Date(th).getUTCFullYear();
    return Math.min(52, 1 + Math.round((th - weekMonday(y, 1) - 3 * 864e5) / (7 * 864e5)));
  }

  function weeksSvg(p) {
    var W = 760, H = 200, pl = 14, pr = 14, zero = 84, cw = currentWeek();
    var max = Math.max(0.3, Math.max.apply(null, p.weeks.map(function (x) { return Math.abs(x.avg || 0); })));
    var bw = (W - pl - pr) / 52, out = '';
    p.weeks.forEach(function (x, i) {
      var v = x.avg || 0, h = Math.max(1.5, Math.abs(v) / max * (zero - 14)), X = pl + i * bw;
      if (x.week === cw) out += '<rect x="' + (X + 0.5).toFixed(1) + '" y="4" width="' + (bw - 1).toFixed(1) + '" height="' + (H - 30) + '" fill="rgba(232,147,24,.08)" stroke="rgba(232,147,24,.6)"/>';
      out += '<rect class="pat-bar" x="' + (X + bw * 0.14).toFixed(1) + '" y="' + (v >= 0 ? zero - h : zero).toFixed(1) + '" width="' + (bw * 0.72).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1" fill="' + (v >= 0 ? '#00C97E' : '#F04050') + '"><title>Week ' + x.week + ' (' + weekLabel(x.week) + '): ' + pct(v) + ', ' + x.win + '% win</title></rect>';
    });
    [1, 5, 9, 14, 18, 22, 27, 31, 35, 40, 44, 48].forEach(function (wk, m) {
      out += '<text x="' + (pl + (wk - 0.5) * bw).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#8296AD" font-family="IBM Plex Mono,monospace">' + MO[m] + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Average return for each week of the year"><line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + zero + '" y2="' + zero + '" stroke="#22324F"/>' + out + '</svg>';
  }

  var LOCKED = '<svg viewBox="0 0 760 200" width="100%" aria-hidden="true">' + Array.from({ length: 52 }, function (_, i) {
    var h = 10 + Math.abs(Math.sin(i * 1.7)) * 50, up = Math.sin(i * 0.9) > -0.3;
    return '<rect x="' + (14 + i * 14.1) + '" y="' + (up ? 84 - h : 84) + '" width="10" height="' + h + '" fill="' + (up ? '#00C97E' : '#F04050') + '"/>';
  }).join('') + '</svg>';

  function shell(name, status, inner) {
    return '<div class="tx-term pat"><div class="tx-term__head"><span class="tx-term__title">' + esc(name) + ' · Weekly &amp; turn-of-month</span><span class="tx-term__status">' + status + '</span></div>' + inner + '</div>';
  }

  function mount(el, o) {
    if (!el) return;
    el.hidden = false;
    if (!o.pro) {
      el.innerHTML = shell(o.name, 'Pro', '<div class="proj-locked" style="min-height:230px"><div class="proj-blur">' + LOCKED + '</div><div class="proj-cta">' +
        '<span class="tx-badge tx-badge--now">🔒 Pro</span><b>Which weeks of the year has ' + esc(o.name) + ' done best?</b>' +
        '<span>All 52 weeks ranked, plus the turn-of-month effect, from up to 15 years of real daily prices.</span>' +
        '<button type="button" class="tx-btn tx-btn--primary">Unlock with Pro</button></div></div>');
      el.querySelector('.tx-btn--primary').addEventListener('click', function () { if (o.onUpgrade) o.onUpgrade(); });
      return;
    }
    el.innerHTML = shell(o.name, 'Loading', '<span class="tx-skel" style="display:block;height:200px;margin:16px"></span>');
    fetch('/api/v1/seasonality?id=' + encodeURIComponent(o.id) + '&view=patterns')
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (p) {
        if (!p || p.source !== 'verified' || !p.weeks) {
          el.innerHTML = shell(o.name, 'Unavailable', '<p class="proj-na">Weekly patterns not available for ' + esc(o.name) + ': they need at least 5 years of real daily prices, and we never show modelled ones.</p>');
          return;
        }
        var li = function (wk, attr) { return '<li ' + attr + '="' + wk.week + '"><span>Week ' + wk.week + ' <small>' + weekLabel(wk.week) + '</small></span><b class="' + (wk.avg >= 0 ? 'tx-up' : 'tx-down') + '">' + pct(wk.avg) + '</b><em>' + wk.win + '% win</em></li>'; };
        var t = p.tom, edge = t.otherAvg4 > 0 && t.windowAvg > 0 ? (t.windowAvg / t.otherAvg4).toFixed(1) + '× a typical 4-day stretch' : (t.windowAvg > t.otherAvg4 ? 'ahead of a typical 4-day stretch' : 'no better than a typical 4-day stretch');
        el.innerHTML = shell(o.name, '<span class="is-live">Pro · ' + p.years + 'Y real data</span>',
          '<div class="pat-head tx-label">Average return by week of the year <span class="tx-muted">(this week highlighted)</span></div>' +
          '<div style="padding:4px 8px 0">' + weeksSvg(p) + '</div>' +
          '<div class="pat-lists"><div><span class="tx-label">Best weeks</span><ol>' + p.bestWeeks.map(function (x) { return li(x, 'data-pat-best'); }).join('') + '</ol></div>' +
          '<div><span class="tx-label">Worst weeks</span><ol>' + p.worstWeeks.map(function (x) { return li(x, 'data-pat-worst'); }).join('') + '</ol></div></div>' +
          '<div class="pat-tom"><span class="tx-label">Turn of the month · last trading day + first 3</span>' +
          '<div class="proj-kpis" style="border-top:0">' +
          '<div><b data-pat="tomAvg" class="' + (t.windowAvg >= 0 ? 'tx-up' : 'tx-down') + '">' + pct(t.windowAvg) + '</b><span class="tx-label">Avg window return</span></div>' +
          '<div><b data-pat="tomWin">' + t.windowWin + '%</b><span class="tx-label">Windows positive</span></div>' +
          '<div><b data-pat="other">' + pct(t.otherAvg4) + '</b><span class="tx-label">Typical 4 days otherwise</span></div>' +
          '<div><b>' + t.windows + '</b><span class="tx-label">Months measured</span></div></div>' +
          '<p class="tx-note" style="margin:0;padding:0 16px 4px">The turn-of-month window has averaged ' + edge + '.</p></div>' +
          '<p class="tx-note proj-note">Averages over the last ' + p.years + ' years of real daily prices. Week dates shown for ' + new Date().getUTCFullYear() + '. A historical pattern, not a forecast.</p>');
      });
  }
  w.TXPatterns = { mount: mount, weekLabel: weekLabel };
})(window);
