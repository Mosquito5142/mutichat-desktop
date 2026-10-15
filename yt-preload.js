// YouTube webview preload — ad-free + low-resource mode (no dependencies)
// Runs before YouTube's own scripts. Code is pushed into the page's main world via
// webFrame.executeJavaScript (bypasses YouTube's CSP / Trusted Types).
const { webFrame, ipcRenderer } = require('electron');

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

  /* Multi-Chat: new-chat cards on top of the video (also in fullscreen) */
  #mc-notify-stack {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
    font-family: 'Prompt', 'Segoe UI', Tahoma, sans-serif;
  }
  .mc-notify-card {
    pointer-events: auto;
    cursor: pointer;
    min-width: 240px;
    max-width: 340px;
    padding: 10px 14px;
    border-radius: 10px;
    background: rgba(15, 23, 42, 0.88);
    border: 1px solid rgba(96, 165, 250, 0.5);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    color: #f1f5f9;
    font-size: 14px;
    line-height: 1.4;
    opacity: 0;
    transform: translateX(16px);
    transition: opacity 0.25s ease, transform 0.25s ease;
  }
  .mc-notify-card.mc-show {
    opacity: 1;
    transform: translateX(0);
  }
  .mc-notify-card .mc-notify-title {
    font-weight: 600;
    color: #93c5fd;
  }
  .mc-notify-card .mc-notify-hint {
    font-size: 12px;
    color: #94a3b8;
  }
`;

webFrame.executeJavaScript(MAIN_WORLD_CODE);

window.addEventListener('DOMContentLoaded', () => {
  webFrame.insertCSS(HIDE_CSS);
});

// ===== Messages from the Multi-Chat host =====
const MAX_CARDS = 3;
const CARD_LIFETIME_MS = 6000;

function getNotifyStack() {
  let stack = document.getElementById('mc-notify-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'mc-notify-stack';
  }
  // In fullscreen only the fullscreen element is visible, so the stack must live inside it
  const parent = document.fullscreenElement || document.body;
  if (parent && stack.parentElement !== parent) parent.appendChild(stack);
  return stack;
}

function removeCard(card) {
  card.classList.remove('mc-show');
  setTimeout(() => card.remove(), 250);
}

ipcRenderer.on('mc-notify', (_event, info) => {
  if (!document.body) return;
  const stack = getNotifyStack();

  // One card per chat account: update it instead of stacking duplicates
  let card = stack.querySelector(`[data-acc-id="${info.accId}"]`);
  if (!card) {
    card = document.createElement('div');
    card.className = 'mc-notify-card';
    card.dataset.accId = String(info.accId);
    const title = document.createElement('div');
    title.className = 'mc-notify-title';
    const body = document.createElement('div');
    const hint = document.createElement('div');
    hint.className = 'mc-notify-hint';
    hint.textContent = 'คลิกเพื่อไปตอบแชท (วิดีโอจะหยุดรอ)';
    card.append(title, body, hint);
    card.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      ipcRenderer.sendToHost('mc-open-chat', info.accId);
      removeCard(card);
    });
    stack.appendChild(card);
    while (stack.children.length > MAX_CARDS) stack.firstElementChild.remove();
    requestAnimationFrame(() => card.classList.add('mc-show'));
  }

  card.children[0].textContent = `💬 ${info.name}`;
  card.children[1].textContent = `${info.platform} — แชทใหม่ ${info.count} รายการ`;
  clearTimeout(card._mcTimer);
  card._mcTimer = setTimeout(() => removeCard(card), CARD_LIFETIME_MS);
});

ipcRenderer.on('mc-pause', () => {
  const video = document.querySelector('#movie_player video');
  if (video && !video.paused) video.pause();
});
