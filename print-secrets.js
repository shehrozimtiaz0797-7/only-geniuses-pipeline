'use strict';
// Shows the 4 values to paste into GitHub -> Settings -> Secrets and variables -> Actions.
const fs = require('fs');
const path = require('path');
const { ROOT, env } = require('./src/lib');

let refresh = '';
try { refresh = JSON.parse(fs.readFileSync(path.join(ROOT, 'token.json'), 'utf8')).refresh_token; } catch (_) { /* missing */ }

const items = [
  ['GEMINI_API_KEY', env('GEMINI_API_KEY')],
  ['YT_CLIENT_ID', env('YT_CLIENT_ID')],
  ['YT_CLIENT_SECRET', env('YT_CLIENT_SECRET')],
  ['YT_REFRESH_TOKEN', refresh],
];
console.log('\nAdd each one as a NEW repository secret (name on the left, value on the right):\n');
for (const [k, v] of items) console.log(`${k.padEnd(18)} ${v || '(MISSING - check .env / run node auth.js)'}`);
console.log('\nDo not share these values with anyone.\n');
