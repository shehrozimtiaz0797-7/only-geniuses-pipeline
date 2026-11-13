'use strict';
// Only Geniuses — makes brain-teaser quiz Shorts from scratch and uploads them.
// Usage:
//   node make-video.js                      SHORTS_PER_RUN Shorts (default 1)
//   node make-video.js --count 2            2 Shorts
//   node make-video.js --topic "space"      question with a theme
//   node make-video.js --kind riddle        riddle | logic | math | pattern
//   node make-video.js --no-upload          make the video but don't upload (for testing)
//   node make-video.js --sample --no-upload test video without any keys
const fs = require('fs');
const path = require('path');
const { ROOT, env, log, slugify } = require('./src/lib');
const { withRetry } = require('./src/retry');
const { writeQuiz, addHistory, patternQuiz, finish } = require('./src/quiz');
const { makeVoices } = require('./src/voice');
const { buildVideo } = require('./src/video');
const { upload } = require('./src/youtube');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] || '');
}
const NO_UPLOAD = process.argv.includes('--no-upload') || env('UPLOAD', 'yes').toLowerCase() === 'no';
const SAMPLE = process.argv.includes('--sample');

function cleanup() {
  const keepDays = Number(env('KEEP_DAYS', '7'));
  const outRoot = path.join(ROOT, 'output');
  for (const d of fs.readdirSync(outRoot)) {
    const p = path.join(outRoot, d);
    try { if (Date.now() - fs.statSync(p).mtimeMs > keepDays * 86400000) fs.rmSync(p, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}

function sampleQuiz() {
  if (arg('--sample') === 'pattern') return finish(patternQuiz(), 0);
  return finish({
    kind: 'logic',
    question: 'A farmer has 17 sheep. All but 9 run away. How many sheep does the farmer have left?',
    voiceQuestion: 'A farmer has 17 sheep. All but 9 run away. How many sheep does the farmer have left?',
    correct: '9', wrong: ['8', '17', '0'],
    explanation: '"All but 9" means 9 sheep stayed. Everyone else ran away.',
  }, 0);
}

async function makeOne(topic, kind) {
  const quiz = SAMPLE ? sampleQuiz() : await writeQuiz(topic, kind);
  const n = new Date(), p = v => String(v).padStart(2, '0');
  const stamp = `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}_${p(n.getHours())}-${p(n.getMinutes())}-${p(n.getSeconds())}`;
  const workDir = path.join(ROOT, 'output', `${stamp}_${slugify(quiz.kind + '-' + quiz.correct)}`);
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'quiz.json'), JSON.stringify(quiz, null, 2));

  const voices = SAMPLE && !env('GEMINI_API_KEY') ? { q: null, a: null } : await makeVoices(quiz, workDir);
  const video = await buildVideo(quiz, voices, workDir);

  let videoId = null;
  if (NO_UPLOAD) log('Upload skipped (--no-upload). Video is in: ' + workDir);
  else ({ id: videoId } = await withRetry('YouTube upload', () => upload(video.file, quiz), { tries: 3, waitMs: 45000, log }));

  if (!SAMPLE) addHistory({ question: quiz.question, answer: quiz.correct, kind: quiz.kind, title: quiz.title, date: new Date().toISOString(), videoId });
  cleanup();
  return { quiz, videoId, file: video.file };
}

(async () => {
  const count = Number(arg('--count') || env('SHORTS_PER_RUN', '1'));
  const topic = arg('--topic') || '';
  const kind = arg('--kind') || '';
  let ok = 0;
  for (let i = 0; i < count; i++) {
    try {
      const r = await makeOne(topic, kind);
      ok++;
      log(`Done ${i + 1}/${count}: "${r.quiz.title}" ${r.videoId ? 'https://youtube.com/shorts/' + r.videoId : ''}`);
    } catch (e) {
      log(`Short ${i + 1}/${count} failed: ${e.stack || e.message}`);
    }
  }
  if (!ok) process.exit(1);
})();
