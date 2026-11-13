# Changes made by Claude (channel manager)

## 2026-11-13
- Backup Gemini text models (3.5-flash, 3.5-flash-lite) when 3.8-flash is busy. Today's 17:50 run got 503 four times and fell back to a number puzzle.
- Voice: send only the spoken lines to Gemini TTS. The question voice was 19 s because the instructions were read aloud.
- Mystery (detective) puzzle kind added; titles 'Only Detectives Can Solve This Mystery'.
- Channel description set; playlist 'Brain Teasers & Riddles' created.

## 2026-11-13 (owner request)
- Daily uploads cut to 3 (Malaysia time: 7:50pm, 11:50pm, 3:50am). A 'gate' job skips runs outside these slots, so cron-job.org needs no change. Manual run outside slots: tick 'force'.
- Reason: many uploads a day were splitting views; fewer videos should each get a bigger push.
