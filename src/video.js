'use strict';
// Builds the final Short: draws the frames (render.py), then adds voice, ticks and the "ding".
const fs = require('fs');
const path = require('path');
const { ROOT, env, log, run, FFMPEG, PYTHON } = require('./lib');
const look = require('../style');
const { makeSounds } = require('./sound');

async function buildVideo(quiz, voices, dir) {
  const countdown = Number(env('COUNTDOWN_SECONDS', '10'));
  const words = quiz.question.split(/\s+/).length;
  const tq = voices.q ? Math.max(4.0, voices.q.dur + 0.8) : Math.min(7, Math.max(4, 2.5 + words * 0.2));
  const tr = voices.a ? Math.max(3.5, voices.a.dur + 1.0) : 4.0;
  const total = tq + countdown + tr;

  const silent = path.join(dir, 'silent.mp4');
  const spec = {
    width: 1080, height: 1920, fps: 30,
    font_bold: path.join(ROOT, 'fonts', 'Poppins-Bold.ttf'),
    font_medium: path.join(ROOT, 'fonts', 'Poppins-Medium.ttf'),
    colors: look.colors,
    brand: look.brand,
    hook: quiz.hook,
    kindLabel: look.kindName[quiz.kind] || '',
    question: quiz.question,
    options: quiz.options,
    answerIndex: quiz.answerIndex,
    explanation: quiz.explanation,
    t_question: tq, countdown, t_reveal: tr,
    ffmpeg: FFMPEG(),
    out: silent,
  };
  const specFile = path.join(dir, 'render.json');
  fs.writeFileSync(specFile, JSON.stringify(spec, null, 2));
  log(`Drawing video (${total.toFixed(1)}s)...`);
  await run(PYTHON(), [path.join(ROOT, 'src', 'render.py'), specFile]);

  const snd = await makeSounds(dir, { tq, cd: countdown, tr, voiceQ: !!voices.q });
  const inputs = ['-i', silent, '-f', 'lavfi', '-t', total.toFixed(2), '-i', 'anullsrc=r=48000:cl=stereo'];
  const filters = [];
  const fx = ['[1:a]'];
  const vox = [];
  let n = 2;
  const add = (file, startSec, vol, label, list = fx) => {
    inputs.push('-i', file);
    filters.push(`[${n}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol},adelay=${Math.round(startSec * 1000)}:all=1[${label}]`);
    list.push(`[${label}]`);
    n++;
  };
  add(snd.whoosh, 0.0, 0.8, 'wh');
  for (let i = 0; i < 4; i++) add(snd.pop, 0.45 + 0.12 * i, 0.55, `p${i}`);
  add(snd.tension, tq, 1.0, 'tn');
  add(snd.win, tq + countdown, 0.95, 'wn');
  if (voices.q) add(voices.q.file, 0.4, 1.0, 'vq', vox);
  if (voices.a) add(voices.a.file, tq + countdown + 0.55, 1.0, 'va', vox);
  // music gets quieter by itself whenever the voice talks (ducking)
  inputs.push('-i', snd.music);
  filters.push(`[${n}:a]aformat=sample_rates=48000:channel_layouts=stereo[mu]`);
  if (vox.length) {
    filters.push(`${vox.join('')}amix=inputs=${vox.length}:duration=longest:normalize=0,apad[vx]`, '[vx]asplit=2[vx1][vx2]',
      '[mu][vx2]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=400:makeup=1[mud]');
    fx.push('[mud]', '[vx1]');
  } else fx.push('[mu]');
  filters.push(`${fx.join('')}amix=inputs=${fx.length}:duration=first:normalize=0,acompressor=threshold=0.3:ratio=2.5:attack=8:release=150,loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000[aout]`);

  const file = path.join(dir, 'final.mp4');
  await run(FFMPEG(), ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'),
    '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-t', total.toFixed(2), '-movflags', '+faststart', file]);
  fs.rmSync(silent, { force: true });
  for (const f of Object.values(snd)) fs.rmSync(f, { force: true });
  log(`Video ready: ${file}`);
  return { file, duration: total };
}

module.exports = { buildVideo };
