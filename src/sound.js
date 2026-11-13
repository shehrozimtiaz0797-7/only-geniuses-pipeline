'use strict';
// All sounds are made by code (no music files, so no copyright problems).
// Question: quiz-show beat (drums, bass, warm chords, echoing arpeggio). Countdown: music stops,
// low drone + heartbeat + clock ticks + riser. Answer: deep impact + bell jingle with reverb, beat comes back.
const fs = require('fs');
const path = require('path');
const { run, FFMPEG } = require('./lib');

const pick = list => list[Math.floor(Math.random() * list.length)];
const f = n => Number(n).toFixed(4);
const REVERB = 'aecho=0.8:0.7:47|83|127|181:0.28|0.21|0.15|0.10';

function gen(file, expr, dur, filters = '') {
  const args = ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `aevalsrc='${expr}':s=48000:d=${f(dur)}`];
  if (filters) args.push('-af', filters);
  args.push(file);
  return run(FFMPEG(), args);
}

// pick one of 4 values depending on which bar we are in
const sel = (vals, bar) => `if(eq(mod(floor(t/${f(bar)}),4),0),${f(vals[0])},if(eq(mod(floor(t/${f(bar)}),4),1),${f(vals[1])},if(eq(mod(floor(t/${f(bar)}),4),2),${f(vals[2])},${f(vals[3])})))`;

const MIN3 = 1.1892, MAJ3 = 1.2599, FIFTH = 1.4983;
// [root Hz, third] - a different chord order and key each video, so videos don't all sound the same
const PROGS = [
  [[110, MIN3], [87.31, MAJ3], [130.81, MAJ3], [98, MAJ3]],     // Am F C G
  [[110, MIN3], [98, MAJ3], [87.31, MAJ3], [82.41, MAJ3]],      // Am G F E
  [[130.81, MAJ3], [98, MAJ3], [110, MIN3], [87.31, MAJ3]],     // C G Am F
  [[110, MIN3], [87.31, MAJ3], [98, MAJ3], [82.41, MIN3]],      // Am F G Em
];

async function makeMusic(dir, total) {
  const bpm = pick([114, 118, 122, 126]);
  const beat = 60 / bpm, bar = beat * 4, s16 = beat / 4;
  const key = pick([1, 1.0595, 1.1225, 0.9439]);
  const prog = pick(PROGS);
  const root = sel(prog.map(c => c[0] * key), bar);
  const third = sel(prog.map(c => c[1]), bar);
  const tb = `mod(t,${f(beat)})`, t8 = `mod(t,${f(beat / 2)})`, t16 = `mod(t,${f(s16)})`, tbar = `mod(t,${f(bar)})`;
  // "pumping" feel: everything ducks a little on each kick
  const pump = `(0.55+0.45*min(1,${tb}/0.16))`;
  const edge = `min(1,${tbar}/0.04)*min(1,(${f(bar)}-${tbar})/0.04)`;
  const p = name => path.join(dir, name);

  await gen(p('m_kick.wav'), `0.9*sin(2*PI*(45*${tb}+3.3*(1-exp(-32*${tb}))))*exp(-7*${tb})*min(1,${tb}/0.002)`, total, 'lowpass=f=180');
  await gen(p('m_hat.wav'), `(random(0)*2-1)*(0.5*exp(-60*mod(t+${f(beat / 2)},${f(beat)}))+0.18*exp(-90*${t16}))`, total, 'highpass=f=7500,volume=0.7');
  await gen(p('m_clap.wav'), `(random(0)*2-1)*exp(-22*mod(t+${f(beat)},${f(beat * 2)}))`, total, `bandpass=f=1600:w=1400,${REVERB},volume=0.9`);
  await gen(p('m_bass.wav'), `(sin(2*PI*(${root})*t)+0.25*sin(4*PI*(${root})*t))*exp(-3*${t8})*min(1,${t8}/0.004)*${edge}*${pump}`, total, 'lowpass=f=500,volume=0.55');
  // warm chord pad, slightly different tuning left/right = wide stereo
  const pad = det => ['1', third, f(FIFTH)].map(m => `sin(2*PI*2*(${root})*${m}*${det}*t)`).join('+');
  const padEnv = `min(1,${tbar}/0.25)*min(1,(${f(bar)}-${tbar})/0.08)*${pump}`;
  await gen(p('m_pad.wav'), `0.16*(${pad('1.003')})*${padEnv}|0.16*(${pad('0.997')})*${padEnv}`, total, `lowpass=f=2400,${REVERB},volume=0.75`);
  // bright arpeggio bouncing left-right, with a dotted echo
  const n16 = `floor(t/${f(s16)})`;
  const arpM = `if(eq(mod(${n16},4),0),2,if(eq(mod(${n16},4),1),2*${third},if(eq(mod(${n16},4),2),${f(2 * FIFTH)},4)))`;
  const pl = `(sin(2*PI*(${root})*${arpM}*t)+0.3*sin(4*PI*(${root})*${arpM}*t))*exp(-10*${t16})*min(1,${t16}/0.003)*min(1,(${f(s16)}-${t16})/0.01)`;
  const lr = `if(eq(mod(${n16},2),0),1,0.45)`, rl = `if(eq(mod(${n16},2),0),0.45,1)`;
  await gen(p('m_arp.wav'), `0.13*${pl}*${lr}|0.13*${pl}*${rl}`, total, `aecho=0.8:0.5:${Math.round(beat * 750)}:0.3,highpass=f=300`);

  const out = p('music_raw.wav');
  const stems = ['m_kick', 'm_hat', 'm_clap', 'm_bass', 'm_pad', 'm_arp'];
  const args = ['-y', '-loglevel', 'error'];
  for (const s of stems) args.push('-i', p(s + '.wav'));
  args.push('-filter_complex', `${stems.map((_, i) => `[${i}:a]aformat=channel_layouts=stereo[s${i}]`).join(';')};${stems.map((_, i) => `[s${i}]`).join('')}amix=inputs=${stems.length}:normalize=0,acompressor=threshold=0.25:ratio=3:attack=10:release=120,alimiter=limit=0.9[m]`, '-map', '[m]', out);
  await run(FFMPEG(), args);
  for (const s of stems) fs.rmSync(p(s + '.wav'), { force: true });
  return out;
}

async function makeSounds(dir, { tq, cd, tr, voiceQ }) {
  const total = tq + cd + tr;
  const s = name => path.join(dir, name);

  // music for the whole video, silent during the countdown
  const raw = await makeMusic(dir, total);
  const under = voiceQ ? 0.55 : 0.75;
  const back = voiceQ ? 0.45 : 0.65;
  const env = `if(lt(t,${f(tq - 0.3)}),${under},if(lt(t,${f(tq)}),${under}*(${f(tq)}-t)/0.3,if(lt(t,${f(tq + cd + 0.3)}),0,if(lt(t,${f(total - 0.7)}),${back}*min(1,(t-${f(tq + cd + 0.3)})/0.3),${back}*(${f(total)}-t)/0.7))))`;
  await run(FFMPEG(), ['-y', '-loglevel', 'error', '-i', raw, '-af', `volume='${env}':eval=frame`, s('music.wav')]);
  fs.rmSync(raw, { force: true });

  // countdown: drone that grows, heartbeat, clock tick-tock, riser in the last 2.5 seconds
  const tau = 'mod(t,1)';
  const drone = `(0.10+0.16*t/${f(cd)})*(sin(2*PI*55*t)+0.6*sin(2*PI*82.4*t)+0.3*sin(2*PI*110.3*t))*(0.75+0.25*sin(2*PI*(1+0.4*t)*t))`;
  const heart = `0.85*sin(2*PI*52*${tau})*exp(-12*${tau})*min(1,${tau}/0.003)+0.6*gte(${tau},0.24)*sin(2*PI*48*(${tau}-0.24))*exp(-12*(${tau}-0.24))`;
  await gen(s('t_low.wav'), `${drone}+${heart}`, cd, 'lowpass=f=320,volume=0.9');
  const pitch = `(1+0.06*floor(t))*if(eq(mod(floor(t),2),0),1,0.82)`;
  await gen(s('t_tick.wav'), `(0.6*sin(2*PI*1900*${pitch}*${tau})*exp(-90*${tau})+0.35*sin(2*PI*2900*${pitch}*${tau})*exp(-140*${tau}))*min(1,${tau}/0.001)`, cd, `${REVERB},volume=0.55`);
  const rs = Math.max(0, cd - 2.5);
  const rt = `max(0,t-${f(rs)})`;
  await gen(s('t_rise.wav'), `gte(t,${f(rs)})*pow(${rt}/2.5,2)*(0.35*sin(2*PI*(200*${rt}+180*${rt}*${rt}))+0.5*(random(0)*2-1))|gte(t,${f(rs)})*pow(${rt}/2.5,2)*(0.35*sin(2*PI*(201*${rt}+180*${rt}*${rt}))+0.5*(random(1)*2-1))`, cd, 'highpass=f=900,volume=0.35');
  await run(FFMPEG(), ['-y', '-loglevel', 'error', '-i', s('t_low.wav'), '-i', s('t_tick.wav'), '-i', s('t_rise.wav'), '-filter_complex',
    '[0:a]aformat=channel_layouts=stereo[a];[1:a]aformat=channel_layouts=stereo[b];[2:a]aformat=channel_layouts=stereo[c];[a][b][c]amix=inputs=3:normalize=0,alimiter=limit=0.9[o]', '-map', '[o]', s('tension.wav')]);
  for (const x of ['t_low', 't_tick', 't_rise']) fs.rmSync(s(x + '.wav'), { force: true });

  // answer: deep impact + sparkly bell jingle (left/right), with reverb
  const impact = '0.9*sin(2*PI*(38*t+2.5*(1-exp(-20*t))))*exp(-4*t)+0.25*(random(0)*2-1)*exp(-18*t)';
  const bell = (fr, at, len = 5) => `gte(t,${at})*0.2*(sin(2*PI*${fr}*(t-${at}))+0.35*sin(2*PI*${fr * 2}*(t-${at}))*exp(-4*(t-${at}))+0.15*sin(2*PI*${f(fr * 2.76)}*(t-${at}))*exp(-9*(t-${at})))*exp(-${len}*(t-${at}))`;
  const notes = [[523.25, 0.04], [659.25, 0.12], [783.99, 0.20], [1046.5, 0.28, 2.5]];
  const L = notes.map(([fr, at, len], i) => `${i % 2 ? 0.6 : 1}*${bell(fr, at, len)}`).join('+');
  const R = notes.map(([fr, at, len], i) => `${i % 2 ? 1 : 0.6}*${bell(fr, at, len)}`).join('+');
  await gen(s('w_bell.wav'), `${L}|${R}`, 2.2, `${REVERB},volume=1.1`);
  await gen(s('w_hit.wav'), impact, 1.2, 'lowpass=f=2500');
  await run(FFMPEG(), ['-y', '-loglevel', 'error', '-i', s('w_hit.wav'), '-i', s('w_bell.wav'), '-filter_complex',
    '[0:a]aformat=channel_layouts=stereo[a];[1:a]aformat=channel_layouts=stereo[b];[a][b]amix=inputs=2:duration=longest:normalize=0[o]', '-map', '[o]', s('win.wav')]);
  fs.rmSync(s('w_bell.wav'), { force: true }); fs.rmSync(s('w_hit.wav'), { force: true });

  // intro whoosh (moves left to right) and soft "pop" for each option
  await gen(s('whoosh.wav'), '0.5*(random(0)*2-1)*pow(sin(PI*t/0.45),2)*(1-t/0.45)|0.5*(random(1)*2-1)*pow(sin(PI*t/0.45),2)*(t/0.45)', 0.45, `highpass=f=800,lowpass=f=9000,${REVERB}`);
  await gen(s('pop.wav'), '0.5*sin(2*PI*(420*t+3500*t*t))*exp(-30*t)*min(1,t/0.002)', 0.15, 'aecho=0.8:0.4:30:0.2');

  return { music: s('music.wav'), tension: s('tension.wav'), win: s('win.wav'), whoosh: s('whoosh.wav'), pop: s('pop.wav') };
}

module.exports = { makeSounds };
