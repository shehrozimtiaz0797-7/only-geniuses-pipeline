'use strict';
// Voice for the question and the answer (Gemini TTS).
// Both are made in ONE request (the free voice limit is only ~10 requests a day), then cut apart at the pause.
// If the voice fails, the video is still made with music and sound effects only.
const fs = require('fs');
const path = require('path');
const { env, log, run, duration, FFMPEG } = require('./lib');
const { speak } = require('./gemini');
const { withRetry, isQuota } = require('./retry');

const spoken = s => String(s)
  .replace(/×/g, ' times ').replace(/÷/g, ' divided by ').replace(/−/g, ' minus ')
  .replace(/(\d)\s*%/g, '$1 percent').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

function sentence(hook) {
  const s = hook.toLowerCase().replace(/\?$/, '');
  return s.charAt(0).toUpperCase() + s.slice(1) + (hook.endsWith('?') ? '?' : '.');
}

const CLEAN = 'highpass=f=90,acompressor=threshold=0.1:ratio=3:attack=5:release=80,equalizer=f=3500:t=q:w=1.2:g=3,equalizer=f=250:t=q:w=1:g=-2,aecho=0.8:0.85:18|29:0.12|0.08,loudnorm=I=-15:TP=-1.5';
const TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse';

async function silences(file) {
  const out = await new Promise(resolve => {
    const { spawn } = require('child_process');
    const p = spawn(FFMPEG(), ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-40dB:d=0.35', '-f', 'null', '-']);
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('close', () => resolve(err));
  });
  const list = [];
  let start = null;
  for (const line of out.split('\n')) {
    const s = line.match(/silence_start: ([\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/);
    if (s) start = Number(s[1]);
    if (e && start !== null) { list.push({ start, end: Number(e[1]), dur: Number(e[2]) }); start = null; }
  }
  return list;
}

async function cut(src, dst, from, to) {
  const trim = `atrim=start=${from.toFixed(3)}${to ? `:end=${to.toFixed(3)}` : ''},asetpts=PTS-STARTPTS`;
  const args = ['-y', '-loglevel', 'error', '-i', src, '-af', `${trim},${TRIM},${CLEAN}`, '-ar', '48000', dst];
  await run(FFMPEG(), args);
  return { file: dst, dur: await duration(dst) };
}

let voiceTurn = 0;
async function makeVoices(quiz, dir) {
  const mode = env('VOICE', 'both').toLowerCase();
  if (mode === 'none' || !env('GEMINI_API_KEY')) return { q: null, a: null };
  const voices = env('GEMINI_TTS_VOICE', 'Puck').split(',').map(s => s.trim()).filter(Boolean);
  const voice = voices[(require('./quiz').readHistory().length + voiceTurn++) % voices.length];

  const qLine = `${spoken(sentence(quiz.hook))} ${spoken(quiz.voiceQuestion)} You have ${env('COUNTDOWN_SECONDS', '10')} seconds!`;
  const aLine = `The answer is ${quiz.answerLetter}, ${spoken(quiz.correct)}! ${spoken(quiz.explanation)}`;
  // Only the words to be spoken: Gemini TTS sometimes reads instructions out loud.
  // The pause between question and answer comes from the paragraph break and the dots.
  const text = mode === 'answer' ? aLine : `${qLine}\n\n... ... ...\n\n${aLine}`;

  try {
    const pcm = await withRetry('Voice', () => speak(text, voice), { tries: 2, waitMs: 20000, log });
    const raw = path.join(dir, 'voice_all.pcm');
    const all = path.join(dir, 'voice_all.wav');
    fs.writeFileSync(raw, pcm);
    await run(FFMPEG(), ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', raw, '-af', TRIM, all]);
    fs.rmSync(raw, { force: true });
    const total = await duration(all);

    if (mode === 'answer') {
      const a = await cut(all, path.join(dir, 'voice_a.wav'), 0, null);
      log(`Voice ready (${voice}): answer ${a.dur.toFixed(1)}s`);
      return { q: null, a };
    }

    // find the pause between the two parts: a long silence near where the answer should start
    const expected = total * qLine.length / (qLine.length + aLine.length);
    const gaps = (await silences(all)).filter(g => g.start > 1 && g.end < total - 0.8);
    const near = g => Math.abs((g.start + g.end) / 2 - expected);
    const best = gaps.filter(g => g.dur >= 0.6).sort((x, y) => near(x) - near(y))[0]
      || gaps.filter(g => g.dur >= 0.4 && near(g) < total * 0.2).sort((x, y) => y.dur - x.dur)[0];
    if (!best) throw new Error('could not find the pause between question and answer');
    const mid = (best.start + best.end) / 2;
    const q = await cut(all, path.join(dir, 'voice_q.wav'), 0, mid);
    const a = await cut(all, path.join(dir, 'voice_a.wav'), mid, null);
    fs.rmSync(all, { force: true });
    log(`Voice ready (${voice}): question ${q.dur.toFixed(1)}s, answer ${a.dur.toFixed(1)}s`);
    return { q, a };
  } catch (e) {
    log(`Voice skipped (video will have music and sound effects only): ${String(e.message).slice(0, 200)}`);
    if (isQuota(e.message)) log('Daily free voice limit reached.');
    return { q: null, a: null };
  }
}

module.exports = { makeVoices };
