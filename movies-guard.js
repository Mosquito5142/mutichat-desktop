// Movies tab: block popups / popunders and page-initiated redirects to other sites.
// will-navigate only fires for navigations the page starts (links, scripts), never for loadURL or
// back/forward — so the address bar, favourites and nav buttons are never blocked.
const { session } = require('electron');
const { MOVIES_PARTITION, isSameSite, isGuardExempt } = require('./movies-util');

function withoutHash(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch (e) {
    return url;
  }
}

function setupMoviesGuard(contents, onBlocked) {
  if (contents.getType() !== 'webview' || contents.session !== session.fromPartition(MOVIES_PARTITION)) return false;

  // New windows: a same-site link opens here; the page re-opening itself (popunder trick)
  // or anything on another site is dropped
  contents.setWindowOpenHandler(({ url }) => {
    const current = contents.getURL();
    if (isSameSite(url, current) && withoutHash(url) !== withoutHash(current)) contents.loadURL(url);
    return { action: 'deny' };
  });

  // Top-frame navigation to another site: stop it and let the user decide
  contents.on('will-navigate', (event) => {
    const current = contents.getURL();
    if (isGuardExempt(current) || isSameSite(event.url, current)) return;
    event.preventDefault();
    onBlocked(event.url);
  });

  return true;
}

module.exports = { setupMoviesGuard };
