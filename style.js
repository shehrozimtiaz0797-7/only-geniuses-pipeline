'use strict';
// Only Geniuses — look and wording of the channel. Safe to edit.
module.exports = {
  brand: 'ONLY GENIUSES',

  // Big line at the top of each video (one is picked per video).
  hooks: [
    'ONLY 1% CAN SOLVE THIS',
    '99% GET THIS WRONG',
    'GENIUS TEST',
    'CAN YOU SOLVE IT IN 10 SECONDS?',
    'MOST PEOPLE FAIL THIS',
    'ARE YOU SMARTER THAN 99%?',
  ],

  // YouTube titles (never give the answer away). {kind} becomes Riddle / Logic Puzzle / Math Puzzle ...
  titles: [
    'Only 1% Can Solve This {kind} 🧠',
    '99% Get This {kind} Wrong 😳',
    'Can You Solve This {kind} in 10 Seconds? ⏱️',
    'Only Geniuses Can Answer This {kind} 🧠',
    'Most People Fail This {kind} 🤯',
    'Are You Smarter Than 99%? {kind} Test 🧠',
  ],

  // How often each kind of question is made (bigger = more often).
  // "pattern" questions are made by code, so their answer is always right.
  mix: { riddle: 30, logic: 25, math: 20, pattern: 25 },

  kindName: { riddle: 'Riddle', logic: 'Logic Puzzle', math: 'Math Puzzle', pattern: 'Number Puzzle' },

  // Colours (R, G, B)
  colors: {
    bgTop: [18, 12, 48],
    bgBottom: [6, 4, 20],
    accent: [255, 204, 0],      // yellow hook / timer
    card: [255, 255, 255],
    cardText: [20, 16, 40],
    option: [40, 32, 90],
    optionText: [255, 255, 255],
    letter: [255, 204, 0],
    correct: [34, 197, 94],
    wrong: [70, 60, 100],
  },

  description: [
    'Can you solve it before the timer runs out? Comment your answer! 👇',
    'A new brain teaser every day. Subscribe and test your brain. 🧠',
    '',
    '#shorts #riddles #brainteaser #iqtest #quiz #puzzle',
  ].join('\n'),

  baseTags: ['riddles', 'brain teaser', 'iq test', 'quiz', 'puzzle', 'logic puzzle', 'only geniuses', 'shorts'],
};
