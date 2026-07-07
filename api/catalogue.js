// api/catalogue.js
// Serves the full asset catalogue (733 items) as JSON. Used by
// /admin.html's Data Coverage Audit to enumerate every asset without
// duplicating the (large) catalogue array client-side. The _data/
// directory itself isn't web-routable, so this small endpoint exposes
// its contents to the browser.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogue = JSON.parse(readFileSync(path.join(__dirname, '_data/catalogue.json'), 'utf8'));

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  res.status(200).json(catalogue);
}
