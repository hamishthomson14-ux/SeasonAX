#!/usr/bin/env node
// scripts/health-check.mjs — probes the site the way visitors and crawlers meet it, and says exactly what is wrong.
// Run hourly against www.timingax.co.uk by .github/workflows/health.yml. Read-only GETs only: it never touches the
// cron, the admin, checkout, chat or email endpoints.
//
//   node scripts/health-check.mjs [base] [--report file.md] [--json file.json] [--only group,group]
//                                 [--skip group|probe,...] [--attempts 2] [--retry-wait 5000] [--timeout 30000]
//                                 [--concurrency 6]
//
// Groups: pages (every public .html file in this checkout), assets (stylesheet, script, sitemap, robots),
// ssr (server-rendered asset, month and compare pages, and the 404s they must give), api (every /api/v1/seasonality
// view and /api/catalogue), prices (live quotes), og (the share image).
//
// Each probe is tried again once (after --retry-wait) before it counts, so one hiccup is not an incident. A probe
// ends as ok, slow (correct but over 15 s: noted, not failed), upstream (the site answered 503 because the price
// provider did not: an outage, not a bug) or fail (a wrong answer, with the reason). Exit 1 on any fail or upstream.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const SLOW_MS = 15000;

// ── expectations ──
// A check receives { status, type, text, json, headers } and returns null (fine) or a short reason.
const want = (status) => (r) => (r.status === status ? null : 'expected ' + status + ', got ' + r.status);
function html(markers = []) {
  return (r) => {
    if (r.status !== 200) return 'expected 200, got ' + r.status;
    if (!/text\/html/.test(r.type)) return 'not HTML (' + (r.type || 'no content-type') + ')';
    if (!/<title/i.test(r.text) || !/<\/html>/i.test(r.text)) return 'not a complete HTML page';
    for (const m of markers) if (!(m instanceof RegExp ? m.test(r.text) : r.text.includes(m))) return 'page is missing "' + m + '"';
    return null;
  };
}
function json(shape, what) {
  return (r) => {
    if (r.status !== 200) return 'expected 200, got ' + r.status;
    if (!r.json) return 'not JSON (' + (r.type || 'no content-type') + ')';
    return shape(r.json) ? null : 'unexpected shape: ' + what;
  };
}
function status404(marker) {
  return (r) => (r.status !== 404 ? 'expected 404, got ' + r.status : marker && !marker.test(r.text) ? 'a 404, but without "' + marker.source + '"' : null);
}
const typed = (re, label) => (r) => (r.status !== 200 ? 'expected 200, got ' + r.status : !re.test(r.type) ? 'not ' + label + ' (' + (r.type || 'no content-type') + ')' : !r.text.length ? 'empty' : null);
const num = (v) => Number.isFinite(+v);

export function buildProbes({ root = ROOT, only = null, skip = [], now = new Date() } = {}) {
  const cat = JSON.parse(fs.readFileSync(path.join(root, 'api/_data/catalogue.json'), 'utf8'));
  const probes = [];
  const add = (group, name, p, check) => probes.push({ group, name, path: p, check });

  // Every public page in this checkout (404.html is reached through an unknown URL below, not directly).
  for (const sub of ['', 'blog', 'academy']) {
    const dir = path.join(root, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) if (f.endsWith('.html') && f !== '404.html') add('pages', (sub ? sub + '/' : '') + f, '/' + (sub ? sub + '/' : '') + f, html());
  }

  add('assets', 'stylesheet', '/assets/tx.css', typed(/text\/css/, 'a stylesheet'));
  add('assets', 'script', '/assets/tx.js', typed(/javascript/, 'a script'));
  add('assets', 'sitemap', '/sitemap.xml', (r) => (r.status !== 200 ? 'expected 200, got ' + r.status : /<(urlset|sitemapindex)/.test(r.text) ? null : 'not a sitemap'));
  add('assets', 'robots', '/robots.txt', (r) => (r.status !== 200 ? 'expected 200, got ' + r.status : /User-agent/i.test(r.text) ? null : 'not a robots.txt'));

  add('ssr', 'asset page sp500', '/seasonality/sp500', html([/S&amp;P 500|S&P 500/, 'id="hub"']));
  add('ssr', 'month page sp500 january', '/seasonality/sp500/january', html(['January']));
  add('ssr', 'compare page aapl vs msft', '/compare/aapl-vs-msft', html(['Apple', 'Microsoft']));
  add('ssr', 'unknown asset is a 404', '/seasonality/not-an-asset', status404());
  const gone = cat.find((a) => a.noHistory);
  if (gone) add('ssr', 'ssr-delisted', '/seasonality/' + gone.id, status404(/no verified price history/i));

  const mm = String(now.getUTCMonth() + 1).padStart(2, '0'), dd = String(now.getUTCDate()).padStart(2, '0');
  const section = cat.find((a) => a.id === 'sp500').catSection;
  const api = (name, q, check) => add('api', name, '/api/v1/seasonality?' + q, check);
  api('months sp500', 'id=sp500', json((j) => Array.isArray(j.months) && j.months.length === 12 && j.months.every((m) => num(m.avgReturn)), '12 months with an average each'));
  api('history sp500', 'id=sp500&view=history', json((j) => Array.isArray(j.points) && j.points.length > 100 && !!j.summary, 'points + summary'));
  api('curve sp500', 'id=sp500&view=curve', json((j) => Array.isArray(j.typical) && j.typical.length >= 365 && j.n >= 5, 'a 365-day typical path from 5+ years'));
  api('grid sp500', 'id=sp500&view=grid', json((j) => Array.isArray(j.months) && j.months.length === 12 && Array.isArray(j.years), '12 months + years'));
  api('track sp500', 'id=sp500&view=track', json((j) => Array.isArray(j.records) && j.records.length > 0 && !!j.summary, 'records + summary'));
  api('patterns sp500', 'id=sp500&view=patterns', json((j) => Array.isArray(j.weeks) && j.weeks.length >= 52, '52+ weeks'));
  api('projection sp500 30 days', 'id=sp500&view=projection&days=30', json((j) => Array.isArray(j.median) && j.median.length > 0 && j.n > 0, 'a median path'));
  api('day sp500 ' + mm + '-' + dd, 'id=sp500&view=day&date=' + mm + '-' + dd, json((j) => !!j.summary && Array.isArray(j.years), 'summary + years'));
  api('month sp500 ' + mm, 'id=sp500&view=month&month=' + +mm + '&years=20', json((j) => !!j.summary && Array.isArray(j.years) && j.years.length > 0, 'summary + years'));
  api('consistency sp500', 'id=sp500&view=consistency', json((j) => j.available === true && Array.isArray(j.months) && j.months.length === 12, 'available with 12 months'));
  api('events (types)', 'view=events', json((j) => Array.isArray(j.types) && j.types.length > 0, 'event types'));
  api('events fed-cut sp500', 'view=events&type=fed-cut&id=sp500', json((j) => Array.isArray(j.events) && j.events.length > 0 && !!j.summary, 'events + summary'));
  api('calendar sp500,ftse100', 'view=calendar&ids=sp500,ftse100', (r) => (r.status !== 200 ? 'expected 200, got ' + r.status : !/text\/calendar/.test(r.type) ? 'not a calendar (' + r.type + ')' : /BEGIN:VEVENT/.test(r.text) ? null : 'a calendar with no events'));
  api('leaderboard ' + section, 'view=leaderboard&section=' + encodeURIComponent(section), (r) => {
    const base = json((j) => Array.isArray(j.rows) && j.rows.length > 0, 'ranked rows')(r);
    if (base) return base;
    const short = (r.json.outages || 0) + (r.json.skipped || 0);
    return short ? { upstream: short + ' of ' + r.json.total + ' assets not ranked (price provider slow or down)' } : null;
  });
  add('api', 'catalogue', '/api/catalogue', json((j) => Array.isArray(j) && j.length > 500, 'the full catalogue'));

  add('prices', 'quotes ^GSPC,AAPL', '/api/prices?quotes=' + encodeURIComponent('^GSPC,AAPL'), json((j) => j && typeof j === 'object' && JSON.stringify(j).includes('GSPC'), 'quotes including ^GSPC'));
  add('og', 'share image sp500', '/api/og/sp500', (r) => (r.status !== 200 ? 'expected 200, got ' + r.status : !/image\/png/.test(r.type) ? 'not a PNG (' + r.type + ')' : r.bytes < 10000 ? 'suspiciously small image (' + r.bytes + ' bytes)' : null));

  return probes.filter((p) => (!only || only.includes(p.group)) && !skip.includes(p.group) && !skip.includes(p.name));
}

// ── running ──
async function fetchOnce(base, p, timeout) {
  const t0 = Date.now();
  let res;
  try { res = await fetch(base + p.path, { redirect: 'manual', headers: { 'User-Agent': 'TimingAX health check (+https://www.timingax.co.uk)' }, signal: AbortSignal.timeout(timeout) }); }
  catch (e) { return { status: 0, ms: Date.now() - t0, ok: false, kind: 'fail', detail: /timeout|abort/i.test(String(e)) ? 'no answer within ' + Math.round(timeout / 1000) + ' s' : 'no answer: ' + String((e && e.message) || e) }; }
  const buf = Buffer.from(await res.arrayBuffer()), ms = Date.now() - t0;
  const type = res.headers.get('content-type') || '', text = /image|font|octet/.test(type) ? '' : buf.toString('utf8');
  let j = null; try { j = JSON.parse(text); } catch (e) { j = null; }
  const r = { status: res.status, type, text, json: j, bytes: buf.length, headers: res.headers };
  // A 503 is the site saying its price provider did not answer (never a modelled figure): an outage, not a bug.
  if (res.status === 503) return { status: 503, ms, ok: false, kind: 'upstream', detail: 'provider outage: ' + ((j && j.hint) || 'the site answered 503 (price provider unavailable)') };
  let why = null;
  try { why = p.check(r); } catch (e) { why = 'check crashed: ' + String((e && e.message) || e); }
  if (why && typeof why === 'object' && why.upstream) return { status: res.status, ms, ok: false, kind: 'upstream', detail: 'provider outage: ' + why.upstream };
  if (why) return { status: res.status, ms, ok: false, kind: 'fail', detail: why };
  return { status: res.status, ms, ok: true, kind: ms > SLOW_MS ? 'slow' : 'ok', detail: ms > SLOW_MS ? 'correct, but took ' + (ms / 1000).toFixed(1) + ' s' : '' };
}

export async function runProbes(base, probes, { attempts = 2, retryWait = 5000, timeout = 30000, concurrency = 6, log = () => {} } = {}) {
  const results = new Array(probes.length);
  let next = 0;
  async function worker() {
    while (next < probes.length) {
      const i = next++, p = probes[i];
      let r, n = 0;
      do {
        if (n) await new Promise((ok) => setTimeout(ok, retryWait));
        r = await fetchOnce(base, p, timeout); n++;
      } while (!r.ok && n < attempts);
      results[i] = { group: p.group, name: p.name, path: p.path, ...r, attempts: n };
      log(results[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, probes.length) }, worker));
  const counts = { ok: 0, slow: 0, upstream: 0, fail: 0 };
  for (const r of results) counts[r.kind]++;
  return { base, at: new Date().toISOString(), counts, results };
}

export function markdown(run) {
  const { counts, results } = run, bad = results.filter((r) => !r.ok), n = results.length;
  const when = run.at.replace('T', ' ').slice(0, 16) + ' UTC';
  const fmt = (r) => '| ' + r.group + ' · ' + r.name + ' (`' + r.path + '`) | ' + (r.status || 'no answer') + ' | ' + (r.ms / 1000).toFixed(1) + ' s | ' + r.detail.replace(/\|/g, '\\|') + ' |';
  const lines = ['## Live health check — ' + when, '', 'Base: ' + run.base + ' · ' + n + ' probes'];
  if (!bad.length) {
    const slowest = results.reduce((a, b) => (b.ms > a.ms ? b : a), results[0]);
    lines.push('', '**All ' + n + ' probes passed.**' + (slowest ? ' Slowest: ' + slowest.name + ' at ' + (slowest.ms / 1000).toFixed(1) + ' s.' : ''));
    if (counts.slow) lines.push('', counts.slow + ' answered correctly but slowly (over ' + SLOW_MS / 1000 + ' s):', '', '| Probe | Status | Time | Note |', '| --- | --- | --- | --- |', ...results.filter((r) => r.kind === 'slow').map(fmt));
    return lines.join('\n') + '\n';
  }
  const outage = counts.upstream ? ' (' + counts.upstream + (counts.upstream === 1 ? ' is' : ' are') + ' a provider outage: the site answered 503 because the price provider did not, so nothing was modelled)' : '';
  lines.push('', '**' + bad.length + ' of ' + n + ' probes failed**' + outage + '.', '', '| Probe | Status | Time | What is wrong |', '| --- | --- | --- | --- |', ...bad.map(fmt));
  lines.push('', 'The other ' + (n - bad.length) + ' probes passed' + (counts.slow ? ' (' + counts.slow + ' slowly)' : '') + '.');
  return lines.join('\n') + '\n';
}

// ── command line ──
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const list = (k) => (opt(k, '') ? opt(k, '').split(',').map((s) => s.trim()).filter(Boolean) : null);
  const base = (argv.find((a, i) => !a.startsWith('--') && (i === 0 || !argv[i - 1].startsWith('--'))) || 'https://www.timingax.co.uk').replace(/\/$/, '');
  const probes = buildProbes({ only: list('--only'), skip: list('--skip') || [] });
  const run = await runProbes(base, probes, {
    attempts: +opt('--attempts', 2), retryWait: +opt('--retry-wait', 5000), timeout: +opt('--timeout', 30000), concurrency: +opt('--concurrency', 6),
    log: (r) => console.log((r.ok ? (r.kind === 'slow' ? 'SLOW' : 'ok  ') : r.kind === 'upstream' ? 'OUT ' : 'FAIL') + ' ' + String(r.ms).padStart(6) + 'ms  ' + r.group + ' · ' + r.name + (r.detail ? '  — ' + r.detail : '') + (r.attempts > 1 ? '  (attempt ' + r.attempts + ')' : '')),
  });
  const md = markdown(run);
  if (opt('--report')) fs.writeFileSync(opt('--report'), md);
  if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(run, null, 2));
  console.log('\n' + md);
  process.exit(run.counts.fail + run.counts.upstream ? 1 : 0);
}
