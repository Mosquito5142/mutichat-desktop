// YouTube webview preload — ad-free + low-resource mode (no dependencies)
// Runs before YouTube's own scripts. Code is pushed into the page's main world via
// webFrame.executeJavaScript (bypasses YouTube's CSP / Trusted Types).
const { webFrame } = require('electron');

const MAIN_WORLD_CODE = `(() => {
  if (window.__mcYtAdblock) return;
  window.__mcYtAdblock = true;

  // 1. json-prune: strip ad payloads before the player sees them (same idea as uBlock/Brave scriptlets)
  const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
  const prune = (obj) => {
    if (obj && typeof obj === 'object') {
      for (const k of AD_KEYS) if (k in obj) delete obj[k];
      if (obj.playerResponse) prune(obj.playerResponse);
    }
    return obj;
  };

  const origParse = JSON.parse;
  JSON.parse = function () {
    const res = origParse.apply(this, arguments);
    try { prune(res); } catch (e) {}
    return res;
  };

  const origJson = Response.prototype.json;
  Response.prototype.json = function () {
    return origJson.apply(this, arguments).then((res) => {
      try { prune(res); } catch (e) {}
      return res;
    });
  };

  let initialPlayerResponse;
  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get() { return initialPlayerResponse; },
      set(v) { initialPlayerResponse = prune(v); }
    });
  } catch (e) {}

  // 2. Low-resource: force H.264 (hardware decoded on most PCs) instead of VP9/AV1
  const HEAVY_CODECS = /vp0?9|av01/i;
  if (window.MediaSource && MediaSource.isTypeSupported) {
    const origSupported = MediaSource.isTypeSupported.bind(MediaSource);
    MediaSource.isTypeSupported = (type) => HEAVY_CODECS.test(type) ? false : origSupported(type);
  }
  const origCanPlay = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (type) {
    return HEAVY_CODECS.test(type) ? '' : origCanPlay.call(this, type);
  };

  // 3. Low-resource: default quality 720p (only if the user never picked one)
  try {
    if (!localStorage.getItem('yt-player-quality')) {
      const now = Date.now();
      localStorage.setItem('yt-player-quality', JSON.stringify({
        data: JSON.stringify({ quality: 720, previousQuality: 720 }),
        expiration: now + 365 * 24 * 60 * 60 * 1000,
        creation: now
      }));
    }
  } catch (e) {}

  // 4. Fallback for ads that slip through + stop hover previews.
  //    Capture-phase media listeners: no MutationObserver, fires only while a video plays.
  let mutedByUs = false;
  document.addEventListener('timeupdate', (e) => {
    const video = e.target;
    const player = video.closest && video.closest('#movie_player');
    if (!player) return;
    if (player.classList.contains('ad-showing')) {
      if (!video.muted) { video.muted = true; mutedByUs = true; }
      if (isFinite(video.duration) && video.currentTime < video.duration - 0.1) {
        video.currentTime = video.duration;
      }
      const skipBtn = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
      if (skipBtn) skipBtn.click();
    } else if (mutedByUs) {
      video.muted = false;
      mutedByUs = false;
    }
  }, true);

  document.addEventListener('play', (e) => {
    const video = e.target;
    if (video.closest && video.closest('ytd-video-preview, #inline-preview-player, #video-preview')) {
      video.pause();
    }
  }, true);
})();`;

const HIDE_CSS = `
  ytd-ad-slot-renderer,
  ytd-in-feed-ad-layout-renderer,
  ytd-banner-promo-renderer,
  ytd-promoted-sparkles-web-renderer,
  ytd-promoted-video-renderer,
  ytd-display-ad-renderer,
  ytd-statement-banner-renderer,
  ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer),
  ytd-reel-video-renderer:has(ytd-ad-slot-renderer),
  #player-ads,
  #masthead-ad,
  .ytp-ad-overlay-container,
  ytd-video-preview,
  #video-preview,
  tp-yt-paper-dialog:has(ytd-enforcement-message-view-model),
  ytd-enforcement-message-view-model {
    display: none !important;
  }
`;

webFrame.executeJavaScript(MAIN_WORLD_CODE);

window.addEventListener('DOMContentLoaded', () => {
  webFrame.insertCSS(HIDE_CSS);
});
