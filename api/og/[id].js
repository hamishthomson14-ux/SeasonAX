// api/og/[id].js
// Dynamically generates a 1200x630 social-share preview image for each
// asset's seasonality page — asset name, ticker, sector/region, and a
// decorative seasonal-shape chart so every shared link looks distinct.
//
// RUNTIME: Node (not Edge). @vercel/og cannot be bundled into an Edge
// Function in this project, and Node lets us read the single source of
// truth in api/_data/ rather than duplicating the catalogue here.
//
// The bars are an ILLUSTRATIVE shape drawn from the sector/region pattern,
// not the asset's verified figures. The real VERIFIED/MODELLED data lives
// on the page itself; this image exists to make shared links visually
// distinctive. The footer says so explicitly.

import { ImageResponse } from '@vercel/og';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

export const config = { runtime: 'nodejs' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE = JSON.parse(readFileSync(path.join(__dirname, '../_data/catalogue.json'), 'utf8'));
const PATTERNS = JSON.parse(readFileSync(path.join(__dirname, '../_data/patterns.json'), 'utf8'));

// id -> catalogue entry, built once per cold start
const BY_ID = new Map(CATALOGUE.map(a => [String(a.id).toLowerCase(), a]));

const AMBER2 = '#F5A52F';
const GREEN = '#00C97E';
const RED = '#F04050';
const BG = '#04070F';
const W = '#EDF2FA';
const W3 = '#8FA3B8';
const W4 = '#4D6880';
const B2 = '#162540';

const IMG_OPTS = {
  width: 1200,
  height: 630,
  headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' },
};

// Small helper so the JSX-less element tree stays readable
const el = (style, children) => ({ type: 'div', props: { style, children } });

function brandRow() {
  return el(
    { display: 'flex', alignItems: 'center', marginBottom: 8 },
    [{
      type: 'div',
      props: {
        style: { fontSize: 34, fontWeight: 800, color: W, display: 'flex' },
        children: [
          { type: 'span', props: { children: 'Timing' } },
          { type: 'span', props: { style: { color: AMBER2 }, children: 'AX' } },
        ],
      },
    }]
  );
}

function fallbackImage() {
  return new ImageResponse(
    el(
      {
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', background: BG,
        fontFamily: 'sans-serif',
      },
      [
        el({ fontSize: 60, fontWeight: 800, color: W, display: 'flex', marginBottom: 12 }, [
          { type: 'span', props: { children: 'Timing' } },
          { type: 'span', props: { style: { color: AMBER2 }, children: 'AX' } },
        ]),
        el({ fontSize: 24, color: W3, display: 'flex' },
          'Market seasonality, measured — timingax.co.uk'),
      ]
    ),
    IMG_OPTS
  );
}

export default async function handler(req) {
  let id = '';
  try {
    const url = new URL(req.url, 'https://www.timingax.co.uk');
    id = (url.pathname.split('/').pop() || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  } catch (e) {
    return fallbackImage();
  }

  const item = BY_ID.get(id);
  if (!item) return fallbackImage();

  const patternKey = item.pattern || 'broadIndex';
  const pattern = PATTERNS[patternKey] || PATTERNS.broadIndex || [];

  // patterns.json stores objects ({m, avg, win}); tolerate plain numbers too.
  const values = pattern.map(p => (typeof p === 'number' ? p : Number(p && p.avg))).slice(0, 12);
  if (values.length !== 12 || values.some(v => !isFinite(v))) return fallbackImage();

  const maxAbs = Math.max(0.5, ...values.map(v => Math.abs(v)));
  const ticker = String(item.ticker || '');
  const displayTicker = ticker.startsWith('^') ? '' : ticker;
  const name = String(item.name || ticker || 'TimingAX');

  const bars = values.map(v => el(
    {
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'flex-end', width: 36, height: 200, marginRight: 8,
    },
    [el({
      width: 36,
      height: Math.max(4, Math.round((Math.abs(v) / maxAbs) * 160)),
      background: v >= 0 ? GREEN : RED,
      borderRadius: 3,
      opacity: 0.85,
    }, [])]
  ));

  return new ImageResponse(
    el(
      {
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: BG, padding: 64, fontFamily: 'sans-serif', position: 'relative',
      },
      [
        brandRow(),
        el({ fontSize: 16, letterSpacing: 4, color: AMBER2, textTransform: 'uppercase', marginBottom: 24, display: 'flex' },
          'SEASONALITY SNAPSHOT'),
        el({ fontSize: name.length > 26 ? 42 : 56, fontWeight: 800, color: W, marginBottom: 8, display: 'flex' },
          name),
        el({ fontSize: 22, color: W4, marginBottom: 36, display: 'flex' },
          [item.sector, item.region, displayTicker].filter(Boolean).join('  \u00b7  ')),
        el({ display: 'flex', alignItems: 'flex-end', height: 200, marginBottom: 8 }, bars),
        el(
          {
            position: 'absolute', bottom: 56, left: 64, right: 64, display: 'flex',
            justifyContent: 'space-between', alignItems: 'center',
            borderTop: `1px solid ${B2}`, paddingTop: 24, fontSize: 18, color: W3,
          },
          [
            el({ display: 'flex' }, 'Historical seasonal data \u2014 timingax.co.uk'),
            el({ color: AMBER2, display: 'flex' }, 'Illustrative pattern'),
          ]
        ),
      ]
    ),
    IMG_OPTS
  );
}
