// ===== Movies tab: ad-free browser in the floating media view =====
// Loaded after renderer.js and shares its globals (MEDIA_SITES, mediaWebviews, activeSite, ytMode,
// toggleMedia, showToast, ipcRenderer, path, pathToFileURL) — don't redeclare those here.
// Ad blocking (movie-adblock.js) and the popup / redirect guard (movies-guard.js) run in the main process.
const { normalizeInput, MOVIES_PARTITION } = require('./movies-util');

const MOVIES_FAVS_KEY = 'mc-movie-favorites';
const MOVIES_HOME_HREF = pathToFileURL(path.join(__dirname, 'movies-home.html')).href;
const MOVIES_INIT_TIMEOUT_MS = 15000;
const MOVIES_BLOCKED_BAR_MS = 8000;

const moviesUrlForm = document.getElementById('movies-urlbar');
const moviesUrlInput = document.getElementById('movies-url-input');
const btnMoviesFav = document.getElementById('btn-movies-fav');
const moviesNavBlocked = document.getElementById('movies-nav-blocked');
const moviesNavBlockedHost = document.getElementById('movies-nav-blocked-host');

let moviesReady = null;
let moviesBlockedUrl = null;
let moviesBlockedTimer = null;

// --- Favourites ---
function getMovieFavorites() {
  try {
    const list = JSON.parse(localStorage.getItem(MOVIES_FAVS_KEY));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function setMovieFavorites(list) {
  try { localStorage.setItem(MOVIES_FAVS_KEY, JSON.stringify(list)); } catch (e) {}
}

function moviesHomeUrl() {
  const url = new URL(MOVIES_HOME_HREF);
  url.searchParams.set('favs', JSON.stringify(getMovieFavorites()));
  return url.href;
}

function isMoviesHome(url) {
  return typeof url === 'string' && url.startsWith(MOVIES_HOME_HREF);
}

// URL to drop when the favourites page asks for it (#remove=<url>), else null
function favoriteRemovalRequest(url) {
  if (!isMoviesHome(url)) return null;
  const hash = new URL(url).hash;
  if (!hash.startsWith('#remove=')) return null;
  try {
    return decodeURIComponent(hash.slice('#remove='.length));
  } catch (e) {
    return null; // malformed escape sequence
  }
}

function moviesWebview() {
  return mediaWebviews.movies || null;
}

// --- Address bar ---
function updateMoviesFavButton(url) {
  const savable = /^https?:/.test(url || '');
  const saved = savable && getMovieFavorites().some((fav) => fav.url === url);
  btnMoviesFav.disabled = !savable;
  btnMoviesFav.classList.toggle('active', saved);
  btnMoviesFav.innerHTML = saved ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-regular fa-star"></i>';
}

function updateMoviesUrlBar(url) {
  // Don't overwrite what the user is typing
  if (document.activeElement !== moviesUrlInput) moviesUrlInput.value = isMoviesHome(url) ? '' : url;
  updateMoviesFavButton(url);
}

moviesUrlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const wv = moviesWebview();
  const url = normalizeInput(moviesUrlInput.value);
  if (!wv || !url) return;
  moviesUrlInput.blur();
  wv.loadURL(url).catch(() => {}); // failures show Chromium's error page
});

// Select everything on focus so a new address can be typed straight away
moviesUrlInput.addEventListener('focus', () => moviesUrlInput.select());

btnMoviesFav.addEventListener('click', () => {
  const wv = moviesWebview();
  if (!wv) return;
  const url = wv.getURL();
  if (!/^https?:/.test(url)) return;
  const list = getMovieFavorites();
  const index = list.findIndex((fav) => fav.url === url);
  if (index >= 0) {
    list.splice(index, 1);
    showToast('ลบออกจากเว็บโปรดแล้ว');
  } else {
    list.push({ url, title: wv.getTitle() || new URL(url).hostname });
    showToast('บันทึกเป็นเว็บโปรดแล้ว');
  }
  setMovieFavorites(list);
  updateMoviesFavButton(url);
});

// --- "A page tried to take us to another site" bar ---
function hideMoviesNavBlocked() {
  clearTimeout(moviesBlockedTimer);
  moviesBlockedUrl = null;
  moviesNavBlocked.classList.add('hidden');
}

ipcRenderer.on('movies-nav-blocked', (_event, url) => {
  // Not watching the movies tab full size: just keep it blocked
  if (activeSite !== 'movies' || ytMode !== 'full') return;
  moviesBlockedUrl = url;
  let host = url;
  try { host = new URL(url).hostname; } catch (e) {}
  moviesNavBlockedHost.textContent = host;
  moviesNavBlocked.classList.remove('hidden');
  clearTimeout(moviesBlockedTimer);
  moviesBlockedTimer = setTimeout(hideMoviesNavBlocked, MOVIES_BLOCKED_BAR_MS);
});

document.getElementById('btn-movies-nav-allow').addEventListener('click', () => {
  const wv = moviesWebview();
  const url = moviesBlockedUrl;
  hideMoviesNavBlocked();
  // Only act while the movies tab is on screen full size (the bar can outlive a site switch)
  if (activeSite !== 'movies' || ytMode !== 'full') return;
  // loadURL never goes through the guard's will-navigate
  if (wv && url) wv.loadURL(url).catch(() => {});
});
document.getElementById('btn-movies-nav-dismiss').addEventListener('click', hideMoviesNavBlocked);

// --- Webview wiring (called by createMediaWebview) ---
function attachMoviesWebview(wv) {
  wv.addEventListener('did-navigate', (e) => {
    hideMoviesNavBlocked();
    updateMoviesUrlBar(e.url);
  });
  wv.addEventListener('did-navigate-in-page', (e) => {
    if (!e.isMainFrame) return;
    const removeUrl = favoriteRemovalRequest(e.url);
    if (removeUrl) {
      setMovieFavorites(getMovieFavorites().filter((fav) => fav.url !== removeUrl));
      wv.loadURL(moviesHomeUrl()).catch(() => {});
      return;
    }
    updateMoviesUrlBar(e.url);
  });
}

// --- Ad blocker start-up (first open only) ---
function ensureMoviesBlocker() {
  if (!moviesReady) {
    showToast('กำลังเตรียมตัวบล็อกโฆษณา...');
    // Always handled, even if it settles after the timeout below
    const init = ipcRenderer.invoke('movies-init').catch(() => ({ ok: false })).then((result) => {
      if (!result || !result.ok) {
        moviesReady = null; // try again next time the tab opens
        showToast('ยังโหลดตัวบล็อกโฆษณาไม่ได้ จะลองใหม่รอบหน้า');
      }
      return result;
    });
    let timer;
    // Slow network: open the page anyway, blocking switches on as soon as the engine is ready
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ ok: true }), MOVIES_INIT_TIMEOUT_MS);
    });
    moviesReady = Promise.race([init, timeout]).then(() => clearTimeout(timer));
  }
  return moviesReady;
}

let moviesOpening = false;

async function toggleMovies() {
  if (moviesOpening) return; // a first open is already waiting on the blocker
  if (!mediaWebviews.movies) {
    moviesOpening = true;
    try {
      await ensureMoviesBlocker();
    } finally {
      moviesOpening = false;
    }
  }
  toggleMedia('movies');
}

MEDIA_SITES.movies = {
  name: 'หนัง',
  title: '<i class="fa-solid fa-film" style="color:#f59e0b;"></i> หนัง ไม่มีโฆษณา',
  url: moviesHomeUrl,
  partition: MOVIES_PARTITION,
  lastUrlKey: 'mv_last_url',
  button: document.getElementById('btn-movies'),
  // Our preload in the player iframes too: PiP seek buttons, "back to tab", video-only mini player
  webpreferences: 'nodeIntegrationInSubFrames',
  onCreate: attachMoviesWebview
};

MEDIA_SITES.movies.button.addEventListener('click', toggleMovies);
// Ctrl+Shift+M works even while a webview has focus (forwarded from main process)
ipcRenderer.on('toggle-movies', toggleMovies);
