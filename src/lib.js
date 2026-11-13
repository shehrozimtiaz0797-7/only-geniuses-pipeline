'use strict';
// Shared helpers: settings from .env / environment, logging, running programs, web requests.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// Read .env (only on your own computer; on GitHub the values come from Secrets).
(function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env) || process.env[key] === '') process.env[key] = val;
  }
})();

function env(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}
function requireEnv(name) {
  const v = env(name);
  if (!v) throw new Error(`${name} is missing. Put it in .env (your computer) or in GitHub Secrets.`);
  return v;
}

const LOG_DIR = path.join(ROOT, 'logs');
function log(...parts) {
  const line = `[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] ${parts.join(' ')}`;
  console.log(line);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, 'pipeline.log'), line + '\n');
  } catch (_) { /* ignore */ }
}

function slugify(s) {
  return String(s || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'video';
}

// Run a program (ffmpeg, python) and fail with its last output lines if it fails.
function run(cmd, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; if (err.length > 200000) err = err.slice(-100000); });
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) resolve(out);
      else reject(new Error(`${path.basename(cmd)} failed (code ${code}): ${err.split('\n').slice(-12).join('\n')}`));
    });
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

const FFMPEG = () => env('FFMPEG_PATH', 'ffmpeg');
const FFPROBE = () => env('FFPROBE_PATH', FFMPEG().replace(/ffmpeg(\.exe)?$/i, m => m.replace('ffmpeg', 'ffprobe')));
const PYTHON = () => env('PYTHON', process.platform === 'win32' ? 'python' : 'python3');

async function duration(file) {
  const out = await run(FFPROBE(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  return Number(out.trim()) || 0;
}

// fetch with a few tries for network hiccups and 5xx/429 answers.
async function fetchRetry(url, opts = {}, tries = 3) {
  let last;
  for (let a = 1; a <= tries; a++) {
    try {
      const res = await fetch(url, opts);
      if (res.status >= 500 || (res.status === 429 && a < tries)) {
        last = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      } else return res;
    } catch (e) { last = e; }
    if (a < tries) await new Promise(r => setTimeout(r, 4000 * a));
  }
  throw last;
}

module.exports = { ROOT, env, requireEnv, log, slugify, run, duration, fetchRetry, FFMPEG, FFPROBE, PYTHON };
