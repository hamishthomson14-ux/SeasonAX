// api/og/[id].js
// Dynamically generates a 1200x630 social-share preview image for each
// asset's seasonality page — asset name, ticker, sector/region, and a
// decorative seasonal-shape chart so every shared link looks distinct.
//
// RUNTIME: Node (not Edge). @vercel/og cannot be bundled into an Edge
// Function in this project, and Node lets us read the single source of
// truth in api/_data/ rather than duplicating the catalogue here.
//
// The bars are the asset's own average return for each calendar month, computed from real prices
// (the same figures as its page). Assets without real price history get the generic card.

import { ImageResponse } from '@vercel/og';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { yahooSymbol, fetchMonthly, computeAdaptiveMonths } from '../_lib/seasonal.js';
import { ogContent } from '../_lib/og.js';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE = JSON.parse(readFileSync(path.join(__dirname, '../_data/catalogue.json'), 'utf8'));

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

// Named GET export: Vercel treats it as Web-style (Request in, Response out). A default export would be called as
// (req, res) and the returned Response never sent, so the request hung until it timed out (504).
export async function GET(req) {
  let id = '';
  try {
    const url = new URL(req.url, 'https://www.timingax.co.uk');
    id = (url.pathname.split('/').pop() || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  } catch (e) {
    return fallbackImage();
  }

  const item = BY_ID.get(id);
  if (!item) return fallbackImage();

  let real = null;
  try { const rows = await fetchMonthly(yahooSymbol(item)); real = rows && computeAdaptiveMonths(rows, 15); } catch (e) { real = null; }
  const c = ogContent(item, real);
  if (!c) return fallbackImage();

  const maxAbs = Math.max(0.5, ...c.bars.map((v) => Math.abs(v)));
  const LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const bars = c.bars.map((v, k) => el(
    { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', width: 44, height: 210, marginRight: 10 },
    [
      el({ display: 'flex', width: 40, height: Math.max(4, Math.round((Math.abs(v) / maxAbs) * 170)), background: v >= 0 ? GREEN : RED, borderRadius: 3, opacity: 0.9 }, []),   // satori: every div needs display
      el({ fontSize: 16, color: W3, marginTop: 8, display: 'flex' }, LETTERS[k]),
    ]
  ));

  return new ImageResponse(
    el(
      { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: BG, padding: 64, fontFamily: 'sans-serif', position: 'relative' },
      [
        brandRow(),
        el({ fontSize: 16, letterSpacing: 4, color: AMBER2, textTransform: 'uppercase', marginBottom: 20, display: 'flex' }, 'SEASONALITY SNAPSHOT'),
        el({ fontSize: c.name.length > 26 ? 42 : 56, fontWeight: 800, color: W, marginBottom: 6, display: 'flex' }, c.name),
        el({ fontSize: 22, color: W4, marginBottom: 26, display: 'flex' }, c.sub),
        el({ display: 'flex', alignItems: 'flex-end' }, [
          el({ display: 'flex', alignItems: 'flex-end', height: 240 }, bars),
          el({ display: 'flex', flexDirection: 'column', marginLeft: 24, marginBottom: 40, fontSize: 24 }, [
            el({ color: GREEN, display: 'flex', marginBottom: 12 }, c.best),
            el({ color: RED, display: 'flex' }, c.worst),
          ]),
        ]),
        el(
          { position: 'absolute', bottom: 48, left: 64, right: 64, display: 'flex', borderTop: `1px solid ${B2}`, paddingTop: 20, fontSize: 18, color: W3 },
          [el({ display: 'flex' }, c.footer)]
        ),
      ]
    ),
    IMG_OPTS
  );
}
