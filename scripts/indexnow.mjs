#!/usr/bin/env node
// Tell Bing and the other IndexNow search engines about every URL in the sitemaps.
//   node scripts/indexnow.mjs            submit (POST to api.indexnow.org, 10,000 URLs per request)
//   node scripts/indexnow.mjs --dry-run  print the payloads, contact nothing
// The key is public by design: the engines confirm ownership by fetching https://www.timingax.co.uk/<key>.txt.
// Run it after a release that adds or changes pages; IndexNow asks sites not to resubmit unchanged URLs often.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'www.timingax.co.uk';
const keyFile = fs.readdirSync(ROOT).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) throw new Error('no IndexNow key file (<32 hex>.txt) at the site root');
const key = keyFile.slice(0, -4);

const urls = [...new Set(fs.readdirSync(ROOT).filter((f) => /^sitemap-.*\.xml$/.test(f)).sort()
  .flatMap((f) => [...fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'))))];
const payloads = [];
for (let i = 0; i < urls.length; i += 10000) payloads.push({ host: HOST, key, keyLocation: `https://${HOST}/${keyFile}`, urlList: urls.slice(i, i + 10000) });

if (process.argv.includes('--dry-run')) {
  process.stdout.write(JSON.stringify(payloads));
} else {
  for (const p of payloads) {
    const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(p) });
    console.log(`${p.urlList.length} URLs -> HTTP ${r.status} ${r.status === 200 || r.status === 202 ? 'accepted' : await r.text()}`);
    if (r.status !== 200 && r.status !== 202) process.exitCode = 1;
  }
}
