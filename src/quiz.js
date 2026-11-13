'use strict';
// Makes one quiz question with 4 options, and double-checks the answer before it is used.
const fs = require('fs');
const path = require('path');
const { ROOT, env, log } = require('./lib');
const { askJSON } = require('./gemini');
const look = require('../style');

const HISTORY = path.join(ROOT, 'history.json');
const LETTERS = ['A', 'B', 'C', 'D'];

function readHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY, 'utf8')); } catch (_) { return []; }
}
function addHistory(entry) {
  const h = readHistory();
  h.push(entry);
  fs.writeFileSync(HISTORY, JSON.stringify(h.slice(-500), null, 2));
}

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = list => list[Math.floor(Math.random() * list.length)];
function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const words = s => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 2 || /^\d+$/.test(w)));
const numbersOf = s => (String(s).match(/\d+/g) || []).join(',');
function similar(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

function pickKind() {
  const entries = Object.entries(look.mix).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) { if ((r -= w) < 0) return k; }
  return entries[0][0];
}

// ---------- Number patterns, made by code (always correct) ----------
function patternQuiz() {
  const makers = [
    () => { const a = rnd(2, 20), d = rnd(3, 13); const t = [0, 1, 2, 3, 4, 5].map(i => a + d * i); return { t, why: `Each number goes up by ${d}.` }; },
    () => { let x = rnd(1, 9); const k = pick([1, 2, 3, 4, 5]); const t = [x]; for (let i = 0; i < 5; i++) t.push(x = x * 2 + k); return { t, why: `Each number is doubled, then ${k} is added.` }; },
    () => { const a = rnd(1, 10), d = rnd(1, 4), s = rnd(1, 3); const t = [a]; for (let i = 0; i < 5; i++) t.push(t[i] + d + s * i); return { t, why: `The gap grows by ${s} each time (+${d}, +${d + s}, +${d + 2 * s}...).` }; },
    () => { const o = rnd(1, 11), k = pick([0, 0, 1, -1, 2, 3, -2, 5]); const t = [0, 1, 2, 3, 4, 5].map(i => (i + o) ** 2 + k); return { t, why: k === 0 ? `They are square numbers: ${o}×${o}, ${o + 1}×${o + 1}, ${o + 2}×${o + 2}...` : `Square numbers ${k > 0 ? 'plus' : 'minus'} ${Math.abs(k)}: ${o}×${o}${k > 0 ? '+' : '−'}${Math.abs(k)}, ${o + 1}×${o + 1}${k > 0 ? '+' : '−'}${Math.abs(k)}...` }; },
    () => { const m = pick([2, 3]), p = rnd(1, 5); let x = rnd(1, 6); const t = [x]; for (let i = 0; i < 5; i++) t.push(x = i % 2 === 0 ? x * m : x + p); return { t, why: `The rule takes turns: ×${m}, then +${p}.` }; },
    () => { const t = [rnd(1, 9), rnd(2, 12)]; while (t.length < 7) t.push(t[t.length - 1] + t[t.length - 2]); return { t: t.slice(0, 6), why: 'Each number is the sum of the two before it.' }; },
    () => { const o = rnd(1, 9); const t = [0, 1, 2, 3, 4, 5].map(i => (i + o) * (i + o + 1)); return { t, why: `${o}×${o + 1}, ${o + 1}×${o + 2}, ${o + 2}×${o + 3}... each is a number times the next one.` }; },
    () => { const a = rnd(60, 120), d = rnd(4, 11); const t = [0, 1, 2, 3, 4, 5].map(i => a - d * i); return { t, why: `Each number goes down by ${d}.` }; },
  ];
  const { t, why } = pick(makers)();
  const shown = t.slice(0, 5), answer = t[5];
  const gap = Math.abs(t[5] - t[4]) || 2;
  const near = [answer + 1, answer - 1, answer + 2, answer - 2, answer + gap, answer - gap, t[4] + Math.abs(t[4] - t[3]), answer + 10, answer - 10];
  const wrong = [...new Set(shuffle(near))].filter(n => n !== answer && n >= 0 && !shown.includes(n)).slice(0, 3);
  return {
    kind: 'pattern',
    question: `What comes next?\n${shown.join(',  ')},  ?`,
    voiceQuestion: `What number comes next? ${shown.join(', ')}, and then?`,
    correct: String(answer),
    wrong: wrong.map(String),
    explanation: why,
  };
}

// ---------- Riddles / logic / math, written by Gemini ----------
const KIND_RULES = {
  riddle: `A short riddle with a clever "aha" answer. Good: a fresh twist people have not seen 100 times. Avoid the most famous riddles (no "what has keys but can't open locks", no "what gets wetter the more it dries", no "the more you take the more you leave behind").`,
  logic: `A short logic or lateral-thinking puzzle (ordering people by height or age, who is lying, trick questions about months/days/counting, family relations like "my father's only son"). It must be solvable in 5-10 seconds of thinking, with a tempting wrong answer.`,
  mystery: `A tiny detective mystery in 2-3 short sentences: a crime or strange event, 3-4 suspects or explanations, and ONE clear clue in the text that proves the answer (e.g. a suspect says something only the thief could know, an alibi that cannot be true, footprints, time of day). The options are the suspects or explanations. The clue must be in the question, so careful readers can solve it without outside knowledge.`,
  math: `A quick mental-math puzzle with a trap, solvable in 5-10 seconds without paper (e.g. "A bat and a ball" style, "half of 2 plus 2", speed/time tricks, "how many months have 28 days" style counting). Write any calculation with clear notation: use × and ÷, always use brackets, never implied multiplication like 2(3+1).`,
};

function geminiPrompt(kind, topic) {
  const past = readHistory().slice(-60).map(h => `- ${h.question.replace(/\s+/g, ' ')} (answer: ${h.answer})`).join('\n') || '- (none yet)';
  return `You write questions for "Only Geniuses", a YouTube Shorts brain-teaser channel.
The viewer sees the question and 4 options, gets 10 seconds, then the answer is revealed.

Kind of question: ${kind}
${KIND_RULES[kind]}
${topic ? `Theme for this question: ${topic}\n` : ''}
Hard rules:
- Exactly ONE option is correct, with no reasonable argument for any other option. If there is any doubt, write a different question.
- No trivia or general knowledge facts (no dates, capitals, famous people, science facts). The answer must come from thinking, not from memory.
- The question is in simple English, at most 24 words (a mystery may use up to 32 words), readable as big text on a phone.
- Each option is at most 4 words (or a number).
- One of the wrong options is the "trap": the answer most people blurt out first.
- The explanation is at most 18 words and shows WHY the answer is right.
- Family friendly. No violence, no politics, no religion, no brands.
- Clearly different from these earlier questions (do not reuse their idea or answer):
${past}

Return ONLY JSON:
{
  "question": "...",
  "correct": "the correct option",
  "wrong": ["trap option", "wrong option", "wrong option"],
  "explanation": "..."
}`;
}

function verifyPrompt(q, options) {
  return `Solve this brain teaser carefully. Think it through fully before answering.

Question: ${q.question.replace(/\n/g, ' ')}
${options.map((o, i) => `${LETTERS[i]}) ${o}`).join('\n')}

Then check the question itself: is exactly one option clearly correct, with no reasonable argument for another option, and no missing information?

Return ONLY JSON: {"answer": "A" | "B" | "C" | "D" | "none", "exactly_one_correct": true | false, "reason": "one short sentence"}`;
}

function cleanQuiz(q, kind) {
  const text = s => String(s || '').replace(/\s+/g, ' ').trim();
  const out = {
    kind,
    question: text(q.question),
    voiceQuestion: text(q.question),
    correct: text(q.correct),
    wrong: (q.wrong || []).map(text).filter(Boolean),
    explanation: text(q.explanation),
  };
  const all = [out.correct, ...out.wrong].map(s => s.toLowerCase());
  if (!out.question || !out.correct || out.wrong.length !== 3) throw new Error('quiz is missing parts');
  if (new Set(all).size !== 4) throw new Error('options are not all different');
  if (out.question.split(' ').length > 40) throw new Error('question too long');
  if ([out.correct, ...out.wrong].some(o => o.length > 28)) throw new Error('an option is too long');
  return out;
}

async function verify(q) {
  const times = Number(env('VERIFY_TIMES', '2'));
  for (let i = 0; i < times; i++) {
    const options = shuffle([q.correct, ...q.wrong]);
    const v = await askJSON(verifyPrompt(q, options), { temperature: 0.2 });
    const idx = LETTERS.indexOf(String(v.answer || '').trim().toUpperCase().slice(0, 1));
    const chosen = idx >= 0 ? options[idx] : 'none';
    if (chosen !== q.correct || v.exactly_one_correct === false) {
      throw new Error(`answer check ${i + 1} disagreed (picked "${chosen}", correct "${q.correct}"): ${v.reason || ''}`);
    }
  }
}

function isRepeat(q) {
  const past = readHistory();
  for (const h of past.slice(-300)) {
    if (q.kind === 'pattern') {
      // number puzzles: only the exact same numbers count as a repeat
      if (h.kind === 'pattern' && numbersOf(h.question) === numbersOf(q.question)) return `same number puzzle as before: "${h.question}"`;
    } else if (similar(h.question, q.question) >= 0.55) return `too close to an earlier question: "${h.question}"`;
  }
  if (q.kind !== 'pattern' && past.slice(-40).some(h => h.kind === q.kind && String(h.answer).toLowerCase() === q.correct.toLowerCase())) {
    return `same answer "${q.correct}" was used recently`;
  }
  return '';
}

function finish(q, n) {
  const options = shuffle([q.correct, ...q.wrong]);
  const answerIndex = options.indexOf(q.correct);
  const kindName = look.kindName[q.kind] || 'Puzzle';
  const title = pick(look.titles).replace('{kind}', kindName);
  return {
    ...q,
    options,
    answerIndex,
    answerLetter: LETTERS[answerIndex],
    hook: look.hooks[n % look.hooks.length],
    title: title.length > 95 ? title.slice(0, 95) : title,
    description: `${look.description}`,
    tags: [...look.baseTags, kindName.toLowerCase()],
  };
}

// Number puzzle that was not used before (tries many times; never fails the video).
function freshPattern() {
  let q;
  for (let i = 0; i < 60; i++) {
    q = patternQuiz();
    if (!isRepeat(q)) break;
  }
  log(`Question ready (pattern): ${q.question.replace(/\n/g, ' ')} -> ${q.correct}`);
  return q;
}

async function writeQuiz(topic, kind) {
  const n = readHistory().length;
  kind = kind || (topic ? pick(['riddle', 'mystery', 'logic', 'math']) : pickKind());
  let lastErr;
  if (kind === 'pattern') return finish(freshPattern(), n);
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      let q;
      if (kind === 'pattern') return finish(freshPattern(), n);
      else {
        q = cleanQuiz(await askJSON(geminiPrompt(kind, topic), { temperature: 1.0 }), kind);
      }
      const rep = isRepeat(q);
      if (rep) throw new Error(rep);
      if (kind !== 'pattern') await verify(q);
      log(`Question ready (${kind}, try ${attempt}): ${q.question.replace(/\n/g, ' ')} -> ${q.correct}`);
      return finish(q, n);
    } catch (e) {
      lastErr = e;
      log(`Question try ${attempt} rejected: ${String(e.message).slice(0, 200)}`);
      if (/quota|RESOURCE_EXHAUSTED|API key/i.test(e.message)) break;
      if (attempt === 4 && kind !== 'pattern') { kind = 'pattern'; log('Switching to a number puzzle (always correct).'); }
    }
  }
  log(`Gemini could not give a checked question (${String(lastErr && lastErr.message).slice(0, 120)}), making a number puzzle instead.`);
  return finish(freshPattern(), n);
}

module.exports = { writeQuiz, readHistory, addHistory, patternQuiz, finish };
