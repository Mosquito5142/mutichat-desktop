// Media actions for the floating view, run in whichever frame holds the clip.
// Movie sites put the player in a cross-origin iframe, which webview.executeJavaScript / webview.send
// (top frame only) can't reach; WebFrameMain can.
const { webContents } = require('electron');
const { pickBestFrame } = require('./movies-util');

const PROBE_TIMEOUT_MS = 500;
const ACTION_TIMEOUT_MS = 3000;

// media-preload.js defines window.__mcMainVideo; frames without it pick the playing / largest video
const PICK_VIDEO = `(window.__mcMainVideo || (() => {
  const videos = Array.from(document.querySelectorAll('video'));
  const playing = videos.find(v => !v.paused && !v.ended);
  if (playing) return playing;
  let best = null;
  let bestArea = 0;
  for (const v of videos) {
    const r = v.getBoundingClientRect();
    if (r.width * r.height > bestArea) { best = v; bestArea = r.width * r.height; }
  }
  return best;
}))()`;

const PROBE = `(() => {
  const v = ${PICK_VIDEO};
  if (!v) return { hasVideo: false, playing: false, area: 0 };
  const r = v.getBoundingClientRect();
  return { hasVideo: true, playing: !v.paused && !v.ended, area: Math.max(0, r.width) * Math.max(0, r.height) };
})()`;

// Run in the frame the probe picked (userGesture: Chromium only opens PiP for a user action)
const FRAME_ACTIONS = {
  'pip-enter': `(() => {
    const v = ${PICK_VIDEO};
    if (!v || !document.pictureInPictureEnabled || v.disablePictureInPicture) return false;
    return v.requestPictureInPicture().then(() => true, () => false);
  })()`,
  'toggle-play': `(() => {
    const v = ${PICK_VIDEO};
    if (!v) return false;
    if (v.paused) v.play().catch(() => {}); else v.pause();
    return true;
  })()`
};

// Run in every frame: the floating / playing video may not be in the frame the probe picks now
const ALL_FRAME_ACTIONS = {
  'pip-exit': `document.pictureInPictureElement ? document.exitPictureInPicture().then(() => true, () => true) : true`,
  'pause': `(document.querySelectorAll('video').forEach(v => { if (!v.paused) v.pause(); }), true)`
};

const BROADCAST_CHANNELS = new Set(['mc-mini']);

// null on error / timeout (frame navigated away, detached, busy)
function runInFrame(frame, code, userGesture = false, timeoutMs = PROBE_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve().then(() => frame.executeJavaScript(code, userGesture)),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); })
  ]).catch(() => null).finally(() => clearTimeout(timer));
}

function webviewFrames(webContentsId) {
  const wc = webContents.fromId(webContentsId);
  if (!wc || wc.isDestroyed() || wc.getType() !== 'webview') return [];
  return wc.mainFrame.framesInSubtree.filter((frame) => !frame.detached);
}

async function runMediaAction(webContentsId, action) {
  const frames = webviewFrames(webContentsId);
  if (ALL_FRAME_ACTIONS[action]) {
    await Promise.all(frames.map((frame) => runInFrame(frame, ALL_FRAME_ACTIONS[action])));
    return true;
  }
  if (action !== 'playing' && !FRAME_ACTIONS[action]) return null;
  const probes = await Promise.all(frames.map((frame) => runInFrame(frame, PROBE)));
  const best = pickBestFrame(probes);
  if (action === 'playing') return best !== null && probes[best].playing;
  if (best === null) return 'no-video';
  return runInFrame(frames[best], FRAME_ACTIONS[action], true, ACTION_TIMEOUT_MS);
}

function broadcastToFrames(webContentsId, channel, args) {
  if (!BROADCAST_CHANNELS.has(channel)) return;
  for (const frame of webviewFrames(webContentsId)) {
    try { frame.send(channel, ...args); } catch (e) {}
  }
}

module.exports = { runMediaAction, broadcastToFrames };
