'use strict';
// Gemini: text (JSON) and text-to-speech.
const { env, requireEnv, fetchRetry } = require('./lib');

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function parseJSON(text) {
  const cleaned = String(text).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {
    const s = cleaned.indexOf('{'); const e = cleaned.lastIndexOf('}');
    if (s !== -1 && e > s) return JSON.parse(cleaned.slice(s, e + 1));
    throw new Error('Gemini did not return valid JSON');
  }
}

async function call(model, body) {
  const res = await fetchRetry(`${BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': requireEnv('GEMINI_API_KEY') },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Gemini ${model} HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

// Main model first; if Google says it is busy (503/429) or missing (404), the backups answer instead.
function textModels() {
  const main = env('GEMINI_TEXT_MODEL', 'gemini-3.8-flash');
  const backups = env('GEMINI_TEXT_FALLBACKS', 'gemini-3.5-flash,gemini-3.5-flash-lite').split(/[,\s]+/).filter(Boolean);
  return [...new Set([main, ...backups])];
}

async function askJSON(prompt, { temperature = 0.9 } = {}) {
  let data, lastErr;
  for (const model of textModels()) {
    try {
      data = await call(model, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, responseMimeType: 'application/json' },
      });
      break;
    } catch (e) {
      lastErr = e;
      if (!/HTTP (503|429|500|404)/.test(e.message)) throw e;
    }
  }
  if (!data) throw lastErr;
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => p.text && !p.thought).map(p => p.text).join('');
  if (!text) throw new Error('Gemini returned no text: ' + JSON.stringify(data).slice(0, 300));
  return parseJSON(text);
}

// Returns raw 16-bit mono PCM at 24000 Hz.
async function speak(text, voice) {
  const model = env('GEMINI_TTS_MODEL', 'gemini-3.8-flash-tts');
  const data = await call(model, {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  });
  const part = (data?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData && p.inlineData.data);
  if (!part) throw new Error('Gemini TTS returned no audio: ' + JSON.stringify(data).slice(0, 300));
  return Buffer.from(part.inlineData.data, 'base64');
}

module.exports = { askJSON, speak, parseJSON };
