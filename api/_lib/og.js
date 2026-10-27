// api/_lib/og.js
// What a share image says about an asset: its own twelve monthly averages and best/worst month from real prices.
// null when the asset has no real price history (the image then shows the generic TimingAX card).
import { MONTH_NAMES, bestWorst } from './seasonal.js';

const pct = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%';

export function ogContent(item, real) {
  if (!item || !real || !real.months || real.months.length !== 12) return null;
  const { best, worst } = bestWorst(real.months);
  return {
    name: String(item.name || item.ticker || 'TimingAX'),
    sub: [item.sector, item.region, String(item.ticker || '').startsWith('^') ? '' : item.ticker].filter(Boolean).join('  ·  '),
    bars: real.months.map((m) => +m.avg),
    best: `Best: ${MONTH_NAMES[best.i]} ${pct(best.avg)} · ${best.win}% up`,
    worst: `Worst: ${MONTH_NAMES[worst.i]} ${pct(worst.avg)} · ${worst.win}% up`,
    footer: `Average return by month · ${real.years} years of real prices · timingax.co.uk`,
  };
}
