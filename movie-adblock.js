// Ad blocking for the Movies tab only (persist:movies): EasyList / uBlock / EasyPrivacy / Peter Lowe /
// EasyList Thailand through Ghostery's engine — network blocking, cosmetic filters and scriptlets, like Brave.
// Loaded lazily the first time the Movies tab opens; the compiled engine is cached on disk.
const fs = require('fs');
const path = require('path');
const { app, session } = require('electron');
const { ElectronBlocker, adsAndTrackingLists } = require('@ghostery/adblocker-electron');
const { MOVIES_PARTITION } = require('./movies-util');

const EASYLIST_THAILAND = 'https://raw.githubusercontent.com/easylist-thailand/easylist-thailand/master/subscription/easylist-thailand.txt';
const FILTER_LISTS = [...adsAndTrackingLists, EASYLIST_THAILAND];
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let initPromise = null;

function cachePath() {
  return path.join(app.getPath('userData'), 'adblock-engine.bin');
}

// Download every list, compile, and cache the result for the next launch
async function buildFromLists() {
  const blocker = await ElectronBlocker.fromLists(fetch, FILTER_LISTS, { enableCompression: true });
  await fs.promises.writeFile(cachePath(), blocker.serialize());
  return blocker;
}

// { blocker, stale } from the cache file, or null (missing / unreadable — a broken file is deleted)
async function loadCached() {
  try {
    const file = cachePath();
    const [buffer, stat] = await Promise.all([fs.promises.readFile(file), fs.promises.stat(file)]);
    return {
      blocker: ElectronBlocker.deserialize(new Uint8Array(buffer)),
      stale: Date.now() - stat.mtimeMs > CACHE_MAX_AGE_MS
    };
  } catch (e) {
    if (e.code !== 'ENOENT') await fs.promises.rm(cachePath(), { force: true }).catch(() => {});
    return null;
  }
}

function initMoviesBlocker() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const moviesSession = session.fromPartition(MOVIES_PARTITION);
    const cached = await loadCached();
    if (cached) {
      cached.blocker.enableBlockingInSession(moviesSession);
      // Fresh lists in the background; used from the next launch
      if (cached.stale) buildFromLists().catch(() => {});
      return { ok: true };
    }
    try {
      const blocker = await buildFromLists();
      blocker.enableBlockingInSession(moviesSession);
      return { ok: true };
    } catch (e) {
      initPromise = null; // offline or a list failed: try again next time the tab opens
      return { ok: false };
    }
  })();
  return initPromise;
}

module.exports = { initMoviesBlocker };
