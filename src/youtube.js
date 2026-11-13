'use strict';
// Uploads the Short to YouTube with the refresh token made by auth.js.
const fs = require('fs');
const { env, requireEnv, log, fetchRetry } = require('./lib');

async function accessToken() {
  const res = await fetchRetry('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('YT_CLIENT_ID'),
      client_secret: requireEnv('YT_CLIENT_SECRET'),
      refresh_token: requireEnv('YT_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`YouTube login failed: ${JSON.stringify(data).slice(0, 300)}. If it says invalid_grant, run "node auth.js" again and update YT_REFRESH_TOKEN.`);
  }
  return data.access_token;
}

async function channelName(token) {
  const res = await fetchRetry('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return data?.items?.[0]?.snippet?.title || '(no channel found on this Google account)';
}

async function upload(file, quiz) {
  const token = await accessToken();
  const size = fs.statSync(file).size;
  const meta = {
    snippet: {
      title: quiz.title,
      description: quiz.description,
      tags: quiz.tags.slice(0, 15),
      categoryId: env('YT_CATEGORY', '27'), // 27 = Education
      defaultLanguage: 'en',
      defaultAudioLanguage: 'en',
    },
    status: {
      privacyStatus: env('PRIVACY', 'public'),
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: false,
    },
  };
  const start = await fetchRetry('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify(meta),
  });
  if (!start.ok) throw new Error(`YouTube upload start failed HTTP ${start.status}: ${(await start.text()).slice(0, 400)}`);
  const where = start.headers.get('location');
  if (!where) throw new Error('YouTube did not give an upload address');

  const put = await fetch(where, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) },
    body: fs.readFileSync(file),
  });
  const text = await put.text();
  if (!put.ok) throw new Error(`YouTube upload failed HTTP ${put.status}: ${text.slice(0, 400)}`);
  const data = JSON.parse(text);
  log(`Uploaded: https://youtube.com/shorts/${data.id} (${meta.status.privacyStatus})`);
  return { id: data.id };
}

module.exports = { accessToken, channelName, upload };
