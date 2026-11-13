'use strict';
// One-time YouTube login on your own computer. Saves the login to token.json.
// Usage: node auth.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ROOT, requireEnv } = require('./src/lib');
const { channelName } = require('./src/youtube');

const CLIENT_ID = requireEnv('YT_CLIENT_ID');
const CLIENT_SECRET = requireEnv('YT_CLIENT_SECRET');
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' });
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' });
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  } catch (_) { /* the link is printed anyway */ }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const code = url.searchParams.get('code');
  if (!code) { res.end('Waiting for Google...'); return; }
  try {
    const redirect = `http://127.0.0.1:${server.address().port}`;
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: redirect, grant_type: 'authorization_code' }),
    });
    const data = await r.json();
    if (!data.refresh_token) throw new Error('No refresh token came back: ' + JSON.stringify(data).slice(0, 300));
    fs.writeFileSync(path.join(ROOT, 'token.json'), JSON.stringify({ refresh_token: data.refresh_token }, null, 2));
    const name = await channelName(data.access_token);
    res.end(`Done! Connected to YouTube channel: ${name}. You can close this tab.`);
    console.log(`\nConnected to YouTube channel: ${name}`);
    console.log('Saved to token.json. Next: node print-secrets.js\n');
  } catch (e) {
    res.end('Login failed: ' + e.message);
    console.error('Login failed:', e.message);
  }
  server.close();
});

server.listen(0, '127.0.0.1', () => {
  const redirect = `http://127.0.0.1:${server.address().port}`;
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirect, response_type: 'code',
    scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent select_account',
  });
  console.log('\nA browser window will open. Sign in with the NEW Google account and pick the Only Geniuses channel.');
  console.log('If it does not open, copy this link into your browser:\n\n' + url + '\n');
  openBrowser(url);
});
