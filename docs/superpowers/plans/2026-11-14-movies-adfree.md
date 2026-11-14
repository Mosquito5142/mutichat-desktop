# Movies Tab (Ad-free Browser + Floating Player) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มแท็บ "หนัง" ใน media view ที่เปิดเว็บไหนก็ได้ บล็อกโฆษณาด้วย filter list แบบ Brave และดึงวิดีโอ (แม้อยู่ใน iframe ข้ามโดเมน) ออกมาเป็นจอลอยได้เหมือน YouTube/TikTok

**Architecture:** หนังเป็น site ที่ 3 ใน `MEDIA_SITES` (partition `persist:movies`) main process ผูก `@ghostery/adblocker-electron` กับ session นั้นแบบ lazy และดักป๊อปอัป/redirect เอง PiP, เล่น/หยุด และ mini layout เปลี่ยนจาก `webview.executeJavaScript`/`webview.send` (top frame เท่านั้น) ไปสั่งผ่าน main process ที่ไล่ `WebFrameMain` ทุกเฟรม ใช้ร่วมกันทุก site

**Tech Stack:** Electron 44 (`<webview>`, `WebFrameMain`, `session.registerPreloadScript`), `@ghostery/adblocker-electron@2.20.3`, `tldts@7`, `node:test`

**Spec:** `docs/superpowers/specs/2026-11-14-movies-adfree-design.md`

## Global Constraints

- Partition หนัง: `persist:movies` (ค่าคงที่ `MOVIES_PARTITION` ใน `movies-util.js`) ห้ามแตะ session ของแชท, `persist:youtube`, `persist:tiktok`
- คีย์ลัด: `Ctrl+Shift+M` → ส่ง `toggle-movies`
- คีย์ `localStorage`: เว็บโปรด `mc-movie-favorites` (`[{url, title}]`), หน้าล่าสุด `mv_last_url`
- ไฟล์ cache engine: `app.getPath('userData')/adblock-engine.bin` อายุ 7 วัน
- filter list: `adsAndTrackingLists` ของ ghostery + `https://raw.githubusercontent.com/easylist-thailand/easylist-thailand/master/subscription/easylist-thailand.txt`
- รอ engine ครั้งแรกไม่เกิน 15 วินาที แล้วเปิดเว็บต่อ (engine เปิดใช้งานเองเมื่อพร้อม)
- ข้อความ UI เป็นภาษาไทย คอมเมนต์ในโค้ดเป็นภาษาอังกฤษ ตามสไตล์ไฟล์เดิม
- `renderer.js` และ `movies.js` เป็น classic script ที่แชร์ global scope กัน: **ห้าม** ประกาศ `const`/`let` ชื่อซ้ำกับ `renderer.js` ใน `movies.js` (เช่น `ipcRenderer`, `path`, `pathToFileURL`) ให้ใช้ของเดิมเลย
- ไม่มีเฟรมเวิร์กเทสต์อื่นนอกจาก `node:test`

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `movies-util.js` (ใหม่) | ฟังก์ชันล้วนที่ไม่พึ่ง Electron: `normalizeInput`, `isSameSite`, `isGuardExempt`, `pickBestFrame`, `MOVIES_PARTITION` |
| `test/movies-util.test.js` (ใหม่) | unit test ของ `movies-util.js` |
| `movie-adblock.js` (ใหม่, main) | สร้าง/cache ghostery engine และเปิดใช้งานใน `persist:movies` |
| `movies-guard.js` (ใหม่, main) | ดักหน้าต่างใหม่และ redirect ข้ามเว็บใน webview หนัง |
| `media-frames.js` (ใหม่, main) | หาเฟรมที่มีวิดีโอแล้วสั่ง PiP/เล่น/หยุด, broadcast ข้อความถึงทุกเฟรม |
| `movies.js` (ใหม่, renderer) | ลงทะเบียน site `movies`, แถบ URL, เว็บโปรด, แถบแจ้งการบล็อก redirect |
| `movies-home.html` (ใหม่) | หน้าเว็บโปรดแบบการ์ด (ไฟล์ในแอป) |
| `main.js` | ลงทะเบียน IPC (`movies-init`, `media-frame`, `media-broadcast`), ต่อ guard, คีย์ลัด |
| `renderer.js` | PiP/เล่น/หยุด/mini ผ่าน IPC ใหม่, hook ทั่วไปของ `MEDIA_SITES` (`url` เป็นฟังก์ชันได้, `webpreferences`, `onCreate`, `data-site`) |
| `media-preload.js` | mini layout แบบทั่วไปสำหรับเว็บที่ไม่ใช่ YouTube/TikTok, ลบ handler ที่ไม่ใช้แล้ว |
| `index.html`, `styles.css` | ปุ่มหนัง, แถบ URL, แถบแจ้งการบล็อก |
| `package.json` | dependency, สคริปต์ `test`, `build.files` |

---

### Task 1: ฟังก์ชันล้วน `movies-util.js` + unit test

**Files:**
- Create: `movies-util.js`
- Create: `test/movies-util.test.js`
- Modify: `package.json` (scripts, dependencies)

**Interfaces:**
- Produces:
  - `MOVIES_PARTITION: 'persist:movies'`
  - `normalizeInput(text: string): string | null` — URL ที่จะเปิด หรือ `null` ถ้าว่าง
  - `isSameSite(a: string, b: string): boolean`
  - `isGuardExempt(url: string): boolean`
  - `pickBestFrame(probes: Array<{hasVideo: boolean, playing: boolean, area: number} | null>): number | null`

- [ ] **Step 1: ติดตั้ง `tldts` และเพิ่มสคริปต์เทสต์**

```bash
npm install tldts@^7.5.2
```

ใน `package.json` ส่วน `"scripts"` เพิ่ม:

```json
"test": "node --test test/*.test.js"
```

- [ ] **Step 2: เขียนเทสต์ที่ยัง fail**

สร้าง `test/movies-util.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeInput, isSameSite, isGuardExempt, pickBestFrame, MOVIES_PARTITION } = require('../movies-util');

const SEARCH = 'https://www.google.com/search?q=';

test('MOVIES_PARTITION', () => {
  assert.equal(MOVIES_PARTITION, 'persist:movies');
});

test('normalizeInput: domains get https', () => {
  assert.equal(normalizeInput('example.com'), 'https://example.com/');
  assert.equal(normalizeInput('  example.co.th/movie?id=1 '), 'https://example.co.th/movie?id=1');
});

test('normalizeInput: full URLs are kept', () => {
  assert.equal(normalizeInput('http://x.com/a'), 'http://x.com/a');
  assert.equal(normalizeInput('HTTPS://Example.com/Path'), 'https://example.com/Path');
});

test('normalizeInput: localhost and IPs get http', () => {
  assert.equal(normalizeInput('localhost:3000'), 'http://localhost:3000/');
  assert.equal(normalizeInput('192.168.1.10/x'), 'http://192.168.1.10/x');
});

test('normalizeInput: anything else is a Google search', () => {
  assert.equal(normalizeInput('หนังใหม่'), SEARCH + encodeURIComponent('หนังใหม่'));
  assert.equal(normalizeInput('hello world.com'), SEARCH + 'hello%20world.com');
});

test('normalizeInput: empty input', () => {
  assert.equal(normalizeInput('   '), null);
  assert.equal(normalizeInput(undefined), null);
});

test('isSameSite: subdomains of the same registrable domain', () => {
  assert.equal(isSameSite('https://a.example.co.th/x', 'https://b.example.co.th/y'), true);
  assert.equal(isSameSite('https://www.example.com/', 'http://cdn.example.com/a.js'), true);
});

test('isSameSite: different sites', () => {
  assert.equal(isSameSite('https://example.com/', 'https://example.net/'), false);
  assert.equal(isSameSite('https://a.co.th/', 'https://b.co.th/'), false);
});

test('isSameSite: localhost compares by hostname', () => {
  assert.equal(isSameSite('http://localhost:3000/a', 'http://localhost:3000/b'), true);
});

test('isSameSite: non-http URLs are never the same site', () => {
  assert.equal(isSameSite('about:blank', 'about:blank'), false);
  assert.equal(isSameSite('file:///C:/a.html', 'file:///C:/b.html'), false);
  assert.equal(isSameSite('', 'https://example.com/'), false);
});

test('isGuardExempt: non-http pages and search engines', () => {
  assert.equal(isGuardExempt(''), true);
  assert.equal(isGuardExempt('file:///C:/app/movies-home.html?favs=%5B%5D'), true);
  assert.equal(isGuardExempt('https://www.google.com/search?q=x'), true);
  assert.equal(isGuardExempt('https://www.google.co.th/search?q=x'), true);
  assert.equal(isGuardExempt('https://www.bing.com/search?q=x'), true);
  assert.equal(isGuardExempt('https://duckduckgo.com/?q=x'), true);
});

test('isGuardExempt: ordinary sites are guarded', () => {
  assert.equal(isGuardExempt('https://movie-site.example.com/watch/1'), false);
  assert.equal(isGuardExempt('https://googleads.example.com/'), false);
});

test('pickBestFrame: a playing video wins even if smaller', () => {
  const probes = [
    { hasVideo: true, playing: false, area: 900 },
    { hasVideo: true, playing: true, area: 100 }
  ];
  assert.equal(pickBestFrame(probes), 1);
});

test('pickBestFrame: no playing video → largest', () => {
  const probes = [
    { hasVideo: true, playing: false, area: 100 },
    { hasVideo: false, playing: false, area: 0 },
    { hasVideo: true, playing: false, area: 900 }
  ];
  assert.equal(pickBestFrame(probes), 2);
});

test('pickBestFrame: several playing → largest playing', () => {
  const probes = [
    { hasVideo: true, playing: true, area: 50 },
    { hasVideo: true, playing: false, area: 5000 },
    { hasVideo: true, playing: true, area: 400 }
  ];
  assert.equal(pickBestFrame(probes), 2);
});

test('pickBestFrame: nothing to pick', () => {
  assert.equal(pickBestFrame([]), null);
  assert.equal(pickBestFrame([null, { hasVideo: false, playing: false, area: 0 }]), null);
});
```

- [ ] **Step 3: รันเทสต์ให้เห็นว่า fail**

Run: `npm test`
Expected: FAIL ด้วย `Cannot find module '../movies-util'`

- [ ] **Step 4: เขียน `movies-util.js`**

```js
// Pure helpers for the Movies tab (no Electron): used by main.js modules and movies.js,
// unit-tested in test/movies-util.test.js
const { parse } = require('tldts');

const MOVIES_PARTITION = 'persist:movies';
const SEARCH_URL = 'https://www.google.com/search?q=';
// Clicking a result on these goes to another site on purpose, so the redirect guard skips them
const SEARCH_ENGINES = new Set(['google', 'bing', 'duckduckgo']);

const LOCAL_HOST = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#]|$)/i;
const DOMAIN_LIKE = /^[^/?#]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i;

function isHttpUrl(url) {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch (e) {
    return false;
  }
}

// Address bar text → URL to load (domain → https, localhost/IP → http, anything else → Google search)
function normalizeInput(text) {
  const input = String(text ?? '').trim();
  if (!input) return null;
  if (/^https?:\/\//i.test(input)) {
    try { return new URL(input).href; } catch (e) { /* not a valid URL: search for it */ }
  }
  if (!/\s/.test(input)) {
    try {
      if (LOCAL_HOST.test(input)) return new URL(`http://${input}`).href;
      if (DOMAIN_LIKE.test(input)) return new URL(`https://${input}`).href;
    } catch (e) { /* fall through to search */ }
  }
  return SEARCH_URL + encodeURIComponent(input);
}

// Registrable domain (a.example.co.th → example.co.th); the hostname for localhost / IPs
function siteOf(url) {
  const { domain, hostname } = parse(url);
  return domain || hostname || null;
}

function isSameSite(a, b) {
  if (!isHttpUrl(a) || !isHttpUrl(b)) return false;
  const site = siteOf(a);
  return !!site && site === siteOf(b);
}

// Pages the redirect guard leaves alone: our own favourites page (file:) / blank, and search engines
function isGuardExempt(url) {
  if (!isHttpUrl(url)) return true;
  return SEARCH_ENGINES.has(parse(url).domainWithoutSuffix);
}

// Frame holding the clip the user is watching: playing first, then the biggest on screen
function pickBestFrame(probes) {
  let best = null;
  probes.forEach((probe, i) => {
    if (!probe || !probe.hasVideo) return;
    if (best === null) { best = i; return; }
    const current = probes[best];
    const better = probe.playing !== current.playing ? probe.playing : probe.area > current.area;
    if (better) best = i;
  });
  return best;
}

module.exports = { MOVIES_PARTITION, normalizeInput, isSameSite, isGuardExempt, pickBestFrame };
```

- [ ] **Step 5: รันเทสต์ให้ผ่าน**

Run: `npm test`
Expected: PASS ทุกเทสต์ (16 tests, 0 fail)

- [ ] **Step 6: Commit**

```bash
git add movies-util.js test/movies-util.test.js package.json package-lock.json
git commit -m "feat: pure helpers for the movies tab (URL input, same-site, frame picking)"
```

---

### Task 2: ตัวบล็อกโฆษณา `movie-adblock.js`

**Files:**
- Create: `movie-adblock.js`
- Modify: `main.js` (require + `ipcMain.handle('movies-init')`)
- Modify: `package.json` (dependency)

**Interfaces:**
- Consumes: `MOVIES_PARTITION` จาก `movies-util.js`
- Produces: IPC `ipcRenderer.invoke('movies-init') → Promise<{ ok: boolean }>` เรียกซ้ำได้ (ได้ promise เดิมถ้ายังไม่ fail)

- [ ] **Step 1: ติดตั้ง ghostery**

```bash
npm install @ghostery/adblocker-electron@^2.20.3
```

- [ ] **Step 2: สร้าง `movie-adblock.js`**

```js
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
```

- [ ] **Step 3: ลงทะเบียน IPC ใน `main.js`**

ใต้ `const fs = require('fs');` (บรรทัด 3) เพิ่ม:

```js
const { initMoviesBlocker } = require('./movie-adblock');
```

ต่อท้าย handler `ipcMain.on('flash-taskbar', ...)` ท้ายไฟล์ เพิ่ม:

```js
// Movies tab: start the ad blocker before its webview is created (no-op after the first call)
ipcMain.handle('movies-init', () => initMoviesBlocker());
```

- [ ] **Step 4: เช็ก syntax และเทสต์เดิม**

Run: `node --check movie-adblock.js && node --check main.js && npm test`
Expected: ไม่มี error, เทสต์ผ่านเหมือนเดิม

- [ ] **Step 5: ทดสอบในแอปจริงว่า engine โหลดและเขียน cache ได้**

Run: `npm start` แล้วเปิด DevTools ของหน้าต่างหลัก (Ctrl+Shift+I) แล้วรันใน console:

```js
await require('electron').ipcRenderer.invoke('movies-init')
```

Expected: `{ok: true}` (ครั้งแรกอาจใช้ 5–20 วินาที) และมีไฟล์ `adblock-engine.bin` ในโฟลเดอร์ `MultiChat_Data_Store` เรียกซ้ำต้องคืนทันที ปิดแอปแล้วเปิดใหม่ เรียกอีกครั้งต้องคืนภายในไม่ถึง 1 วินาที (โหลดจาก cache)

- [ ] **Step 6: Commit**

```bash
git add movie-adblock.js main.js package.json package-lock.json
git commit -m "feat: Ghostery ad blocker for the movies session, cached on disk"
```

---

### Task 3: ดักป๊อปอัปและ redirect `movies-guard.js` + คีย์ลัด

**Files:**
- Create: `movies-guard.js`
- Modify: `main.js:116-152` (`web-contents-created`)

**Interfaces:**
- Consumes: `MOVIES_PARTITION`, `isSameSite`, `isGuardExempt` จาก `movies-util.js`
- Produces:
  - `setupMoviesGuard(contents: WebContents, onBlocked: (url: string) => void): boolean` คืน `true` ถ้าเป็น webview หนัง (ติด guard แล้ว)
  - ข้อความ main → renderer: `'movies-nav-blocked', url: string`
  - ข้อความ main → renderer: `'toggle-movies'`

- [ ] **Step 1: สร้าง `movies-guard.js`**

```js
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
```

- [ ] **Step 2: ต่อ guard และคีย์ลัดใน `main.js`**

ใต้บรรทัด `const { initMoviesBlocker } = require('./movie-adblock');` เพิ่ม:

```js
const { setupMoviesGuard } = require('./movies-guard');
```

แทนที่บรรทัด 117–121:

```js
  // Ctrl+Shift+Y / Ctrl+Shift+K toggle YouTube / TikTok even when a webview has keyboard focus
  contents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !input.control) return;
    // Ctrl+Shift+Y = YouTube, Ctrl+Shift+K = TikTok
    const mediaToggle = input.shift && { y: 'toggle-youtube', k: 'toggle-tiktok' }[input.key.toLowerCase()];
```

ด้วย:

```js
  // Ctrl+Shift+Y / K / M toggle YouTube / TikTok / Movies even when a webview has keyboard focus
  contents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !input.control) return;
    const mediaToggle = input.shift && { y: 'toggle-youtube', k: 'toggle-tiktok', m: 'toggle-movies' }[input.key.toLowerCase()];
```

แทนที่บล็อก webview (บรรทัด 144–151):

```js
  if (contents.getType() === 'webview') {
    contents.setUserAgent(CHROME_USER_AGENT);
    
    // Allow Facebook login popups/oauth within the same webview
    contents.setWindowOpenHandler(({ url }) => {
      contents.loadURL(url);
      return { action: 'deny' };
    });
  }
```

ด้วย:

```js
  if (contents.getType() === 'webview') {
    contents.setUserAgent(CHROME_USER_AGENT);

    const isMovies = setupMoviesGuard(contents, (url) => {
      if (mainWindow) mainWindow.webContents.send('movies-nav-blocked', url);
    });
    if (!isMovies) {
      // Allow Facebook login popups/oauth within the same webview
      contents.setWindowOpenHandler(({ url }) => {
        contents.loadURL(url);
        return { action: 'deny' };
      });
    }
  }
```

- [ ] **Step 3: เช็ก syntax**

Run: `node --check movies-guard.js && node --check main.js && npm test`
Expected: ไม่มี error, เทสต์ผ่าน

- [ ] **Step 4: Commit**

```bash
git add movies-guard.js main.js
git commit -m "feat: block popups and cross-site redirects in the movies webview"
```

(ทดสอบพฤติกรรมจริงใน Task 7 หลังมี UI)

---

### Task 4: PiP / เล่น / หยุด / mini ผ่านทุกเฟรม (`media-frames.js`)

เปลี่ยนโค้ดที่ YouTube/TikTok ใช้อยู่ด้วย ต้องเทสต์สองตัวนี้ซ้ำในขั้นนี้

**Files:**
- Create: `media-frames.js`
- Modify: `main.js` (IPC `media-frame`, `media-broadcast`)
- Modify: `renderer.js:559-575` (`setYoutubeMode`), `:577-603` (PiP), `:612-641` (`createMediaWebview` dom-ready), `:643-657` (`openMedia`), `:663-686` (`isPlayingVideo`, `leaveYoutube`), `:850-852` (ปุ่มเล่นใน mini)

**Interfaces:**
- Consumes: `pickBestFrame` จาก `movies-util.js`
- Produces:
  - `ipcRenderer.invoke('media-frame', webContentsId: number, action) → Promise<...>`
    - `'playing'` → `boolean`
    - `'pip-enter'` → `true | false | 'no-video'`
    - `'toggle-play'` → `boolean | 'no-video'`
    - `'pip-exit'`, `'pause'` → `true` (รันทุกเฟรม)
    - action อื่น → `null`
  - `ipcRenderer.invoke('media-broadcast', webContentsId, channel, ...args)` อนุญาตเฉพาะ `channel === 'mc-mini'`
  - renderer: `mediaFrame(action, wv = ytWebview): Promise<any | null>` และ `broadcastToMedia(wv, channel, ...args): void`

- [ ] **Step 1: สร้าง `media-frames.js`**

```js
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
```

- [ ] **Step 2: ลงทะเบียน IPC ใน `main.js`**

ใต้ `const { setupMoviesGuard } = require('./movies-guard');` เพิ่ม:

```js
const { runMediaAction, broadcastToFrames } = require('./media-frames');
```

ท้ายไฟล์ ต่อจาก `movies-init` เพิ่ม:

```js
// Floating media view: PiP / play / pause in whichever frame holds the video (media-frames.js)
ipcMain.handle('media-frame', (event, webContentsId, action) => runMediaAction(webContentsId, action));
ipcMain.handle('media-broadcast', (event, webContentsId, channel, ...args) => broadcastToFrames(webContentsId, channel, args));
```

- [ ] **Step 3: เปลี่ยนโค้ด PiP ใน `renderer.js`**

แทนที่บรรทัด 577–603 (ตั้งแต่ `// ===== Picture-in-Picture:` ถึงจบ `popOutYoutube`):

```js
// ===== Picture-in-Picture: Chromium's own floating video window (stays on top of every app, like Chrome) =====
// The clip may sit in a cross-origin iframe (movie sites), so the main process picks the frame
// that holds it and runs the action there (media-frames.js).
function mediaFrame(action, wv = ytWebview) {
  if (!wv) return Promise.resolve(null);
  let id;
  try { id = wv.getWebContentsId(); } catch (e) { return Promise.resolve(null); } // not attached yet
  return ipcRenderer.invoke('media-frame', id, action).catch(() => null);
}

// Message to the preload in every frame of the page (webview.send only reaches the top frame)
function broadcastToMedia(wv, channel, ...args) {
  if (!wv) return;
  try {
    ipcRenderer.invoke('media-broadcast', wv.getWebContentsId(), channel, ...args).catch(() => {});
  } catch (e) {} // not attached yet
}

// true = floating, false = PiP refused, 'no-video' = nothing to float
function enterPip() {
  return ytWebview ? mediaFrame('pip-enter') : Promise.resolve(false);
}

function exitPip(wv = ytWebview) {
  return mediaFrame('pip-exit', wv);
}

// Pop the clip out of the app on demand (button on the media bar / mini player)
async function popOutYoutube() {
  if (!ytWebview) return;
  const result = await enterPip();
  if (result === true) setYoutubeMode('pip');
  else if (result === 'no-video') showToast('ยังไม่เจอวิดีโอ กดเล่นก่อนแล้วลองใหม่');
  else showToast('เครื่องนี้เปิดหน้าต่างลอยไม่ได้ ใช้จอเล็กในโปรแกรมแทน');
}
```

- [ ] **Step 4: เปลี่ยน `mc-mini` / `mc-pause` / `mc-toggle-play` ใน `renderer.js`**

ใน `setYoutubeMode` แทนที่:

```js
  sendToYoutube('mc-mini', mode === 'mini');
```

ด้วย:

```js
  broadcastToMedia(ytWebview, 'mc-mini', mode === 'mini');
```

ใน `createMediaWebview` แทนที่:

```js
  wv.addEventListener('dom-ready', () => { if (wv === ytWebview) sendToYoutube('mc-mini', ytMode === 'mini'); });
```

ด้วย:

```js
  wv.addEventListener('dom-ready', () => { if (wv === ytWebview) broadcastToMedia(wv, 'mc-mini', ytMode === 'mini'); });
```

ใน `openMedia` แทนที่:

```js
    exitPip(prev);
    sendToYoutube('mc-pause');
    sendToYoutube('mc-mini', false);
```

ด้วย:

```js
    exitPip(prev);
    mediaFrame('pause', prev);
    broadcastToMedia(prev, 'mc-mini', false);
```

แทนที่ `isPlayingVideo` ทั้งฟังก์ชัน:

```js
async function isPlayingVideo() {
  return (await mediaFrame('playing')) === true;
}
```

ใน `leaveYoutube` แทนที่:

```js
  const inPip = playing && await enterPip();
```

ด้วย:

```js
  const inPip = playing && (await enterPip()) === true;
```

และแทนที่ `sendToYoutube('mc-pause');` ใน `leaveYoutube` ด้วย:

```js
    mediaFrame('pause');
```

แทนที่ handler ปุ่มเล่นใน mini (บรรทัด 850–852):

```js
document.getElementById('btn-yt-mini-play').addEventListener('click', () => {
  mediaFrame('toggle-play');
});
```

- [ ] **Step 5: ตรวจว่าไม่เหลือที่เรียกของเก่า**

Run: `grep -n "PIP_VIDEO\|sendToYoutube('mc-pause\|sendToYoutube('mc-mini\|sendToYoutube('mc-toggle" renderer.js`
Expected: ไม่เจออะไร (`sendToYoutube('mc-notify'...` ยังอยู่ได้)

Run: `node --check renderer.js && node --check media-frames.js && node --check main.js && npm test`
Expected: ไม่มี error

- [ ] **Step 6: ทดสอบ YouTube และ TikTok ซ้ำในแอปจริง**

Run: `npm start` แล้วทำตามนี้:
- YouTube: เปิดคลิป → ปุ่มลอย → PiP ขึ้น, กรอ ±10 วินาทีใน PiP ใช้ได้, "กลับไปที่แท็บ" กลับมาแบบเต็ม
- YouTube: เล่นคลิปแล้วกดแท็บแชท → ลอยเอง ปิด PiP → หยุดและซ่อน
- YouTube: บังคับ mini (ปิด PiP ด้วยการกดแชทตอน PiP ไม่ได้ หรือเรียก `setYoutubeMode('mini')` ใน DevTools) → mini เห็นแค่วิดีโอ, ปุ่มเล่น/หยุดใน mini ใช้ได้
- TikTok: เปิด For You → ลอย → คลิปยังเล่นต่อตอนดูแชท
- สลับ YouTube ↔ TikTok: อันเดิมหยุด
- กดลอยตอนหน้าไม่มีวิดีโอ (หน้าแรก YouTube) → toast "ยังไม่เจอวิดีโอ กดเล่นก่อนแล้วลองใหม่"

Expected: ทุกข้อทำงานเหมือนก่อนแก้ (ยกเว้น toast ข้อสุดท้ายที่เป็นของใหม่)

- [ ] **Step 7: Commit**

```bash
git add media-frames.js main.js renderer.js
git commit -m "refactor: run PiP / play / pause in the frame that holds the video"
```

---

### Task 5: mini player แบบทั่วไปใน `media-preload.js`

**Files:**
- Modify: `media-preload.js:251-256` (insertCSS), `:312-323` (handler `mc-mini`, ลบ `mc-toggle-play`), `:330-333` (ลบ `mc-pause`)

**Interfaces:**
- Consumes: ข้อความ `mc-mini` (boolean) จาก `media-broadcast` (ทุกเฟรม)
- Produces: attribute `data-mc-mini-target` บน `<video>`/`<iframe>` ที่ใหญ่ที่สุดในเฟรม ตอน mini

- [ ] **Step 1: เพิ่ม CSS สำหรับเว็บทั่วไป**

ต่อจากค่าคงที่ `COMMON_CSS` (หลังบรรทัด 249) เพิ่ม:

```js
// Other sites (movies tab): the mini player shows only the biggest video / player iframe of each frame
const GENERIC_MINI_CSS = `
  html.mc-mini, html.mc-mini body {
    overflow: hidden !important;
  }
  html.mc-mini [data-mc-mini-target] {
    position: fixed !important;
    inset: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    border: 0 !important;
    z-index: 2147483646 !important;
    background: #000 !important;
    object-fit: contain !important;
  }
`;
const IS_OTHER_SITE = !IS_YOUTUBE && !IS_TIKTOK;
```

แทนที่บล็อก `DOMContentLoaded` (บรรทัด 253–256):

```js
window.addEventListener('DOMContentLoaded', () => {
  webFrame.insertCSS(COMMON_CSS);
  if (IS_YOUTUBE) webFrame.insertCSS(YOUTUBE_CSS);
  if (IS_OTHER_SITE) webFrame.insertCSS(GENERIC_MINI_CSS);
});
```

- [ ] **Step 2: เลือกเป้าหมาย mini และลบ handler ที่ไม่ใช้แล้ว**

แทนที่บรรทัด 312–323 (handler `mc-mini` และ `mc-toggle-play`):

```js
// Biggest <video> / <iframe> in this frame: the player (or the iframe holding it)
function markMiniTarget(on) {
  document.querySelectorAll('[data-mc-mini-target]').forEach((el) => el.removeAttribute('data-mc-mini-target'));
  if (!on) return;
  let best = null;
  let bestArea = 0;
  for (const el of document.querySelectorAll('video, iframe')) {
    const r = el.getBoundingClientRect();
    if (r.width * r.height > bestArea) { best = el; bestArea = r.width * r.height; }
  }
  if (best) best.setAttribute('data-mc-mini-target', '');
}

// Sent to every frame (media-broadcast); play / pause / PiP run from the main process (media-frames.js)
ipcRenderer.on('mc-mini', (_event, on) => {
  document.documentElement.classList.toggle('mc-mini', !!on);
  if (IS_OTHER_SITE) markMiniTarget(!!on);
  // Let the player recompute its size for the new layout
  window.dispatchEvent(new Event('resize'));
});
```

ลบบรรทัด 330–333 (handler `mc-pause`) ทิ้ง

- [ ] **Step 3: ตรวจ**

Run: `grep -n "mc-pause\|mc-toggle-play" media-preload.js renderer.js && node --check media-preload.js`
Expected: grep ไม่เจออะไร, ไม่มี syntax error

Run: `npm start` → YouTube mini ยังเห็นแค่วิดีโอ, TikTok mini ยังเป็นแบบเดิม

- [ ] **Step 4: Commit**

```bash
git add media-preload.js
git commit -m "feat: video-only mini player layout for any site"
```

---

### Task 6: UI แท็บหนัง (ปุ่ม, แถบ URL, เว็บโปรด, แถบแจ้งการบล็อก)

**Files:**
- Create: `movies.js`, `movies-home.html`
- Modify: `renderer.js` (`MEDIA_SITES` hooks), `index.html`, `styles.css`

**Interfaces:**
- Consumes:
  - IPC `movies-init` (Task 2), ข้อความ `movies-nav-blocked` และ `toggle-movies` (Task 3)
  - global จาก `renderer.js`: `MEDIA_SITES`, `mediaWebviews`, `activeSite`, `ytMode`, `toggleMedia`, `showToast`, `ipcRenderer`, `path`, `pathToFileURL`
  - `normalizeInput`, `MOVIES_PARTITION` จาก `movies-util.js`
- Produces:
  - hook ใหม่ของ config ใน `MEDIA_SITES`: `url` เป็น string หรือฟังก์ชัน `() => string`, `webpreferences?: string`, `onCreate?: (wv) => void`
  - attribute `data-site` บน `#youtube-view` = site ที่แสดงอยู่

- [ ] **Step 1: hook ทั่วไปใน `renderer.js`**

ต่อจากปิด `const MEDIA_SITES = { ... };` (หลังบรรทัด 535) เพิ่ม:

```js
// Start / home page of a site (a site may build it on demand, e.g. the movies favourites page)
function siteUrl(cfg) {
  return typeof cfg.url === 'function' ? cfg.url() : cfg.url;
}
```

ใน `createMediaWebview` แทนที่:

```js
  let startUrl = cfg.url;
```

ด้วย:

```js
  let startUrl = siteUrl(cfg);
```

ต่อจาก `wv.setAttribute('preload', MEDIA_PRELOAD_URL);` เพิ่ม:

```js
  if (cfg.webpreferences) wv.setAttribute('webpreferences', cfg.webpreferences);
```

ก่อน `youtubeHost.appendChild(wv);` เพิ่ม:

```js
  if (cfg.onCreate) cfg.onCreate(wv);
```

ใน `openMedia` ต่อจาก `activeSite = site;` เพิ่ม:

```js
  youtubeView.dataset.site = site;
```

ใน `youtubeNav` แทนที่:

```js
  else if (action === 'home') ytWebview.loadURL(MEDIA_SITES[activeSite].url);
```

ด้วย:

```js
  else if (action === 'home') ytWebview.loadURL(siteUrl(MEDIA_SITES[activeSite]));
```

- [ ] **Step 2: HTML ใน `index.html`**

ต่อจากปุ่ม TikTok (หลังบรรทัด 49) เพิ่ม:

```html
        <button id="btn-movies" class="action-btn media-btn movies-btn" title="เปิด/ซ่อน แท็บหนัง ไม่มีโฆษณา (Ctrl+Shift+M)">
          <i class="fa-solid fa-film"></i>
          <span>หนัง</span>
        </button>
```

ต่อจาก `<span id="media-title" ...>...</span>` (บรรทัด 80) เพิ่ม:

```html
          <!-- Movies tab only: address bar + favourite -->
          <form id="movies-urlbar" class="movies-urlbar">
            <input id="movies-url-input" type="text" spellcheck="false" autocomplete="off" placeholder="พิมพ์ URL หรือคำค้นหา แล้วกด Enter">
            <button id="btn-movies-fav" type="button" class="pane-btn" title="บันทึก / ลบ เว็บโปรด"><i class="fa-regular fa-star"></i></button>
          </form>
```

ก่อน `<div id="youtube-webview-host" class="youtube-webview-host"></div>` เพิ่ม:

```html
        <!-- Movies tab: a page tried to take us to another site -->
        <div id="movies-nav-blocked" class="movies-nav-blocked hidden">
          <i class="fa-solid fa-shield-halved"></i>
          <span>บล็อกไว้: เว็บพยายามพาไป <b id="movies-nav-blocked-host"></b></span>
          <button id="btn-movies-nav-allow" type="button" class="btn-secondary">ไปต่อ</button>
          <button id="btn-movies-nav-dismiss" type="button" class="pane-btn" title="ปิด"><i class="fa-solid fa-xmark"></i></button>
        </div>
```

ต่อจาก `<script src="renderer.js"></script>` เพิ่ม:

```html
  <script src="movies.js"></script>
```

- [ ] **Step 3: CSS ใน `styles.css`**

ต่อท้ายบล็อก `.youtube-webview-host webview { ... }` เพิ่ม:

```css
/* Movies tab — ad-free browser in the floating view */
.movies-btn i {
  color: #f59e0b;
}

.movies-urlbar {
  display: none;
  flex: 1;
  min-width: 0;
  max-width: 760px;
  align-items: center;
  gap: 4px;
}

.youtube-view[data-site="movies"] .movies-urlbar {
  display: flex;
}

.youtube-view[data-site="movies"] #media-title {
  display: none;
}

.movies-urlbar input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid #334155;
  background: #0f172a;
  color: #e5e7eb;
  font: inherit;
  font-size: 13px;
  outline: none;
}

.movies-urlbar input:focus {
  border-color: #60a5fa;
}

#btn-movies-fav.active i {
  color: #f59e0b;
}

#btn-movies-fav:disabled {
  opacity: 0.4;
  cursor: default;
}

.movies-nav-blocked {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #422006;
  border-bottom: 1px solid #92400e;
  color: #fde68a;
  font-size: 13px;
  flex-shrink: 0;
}

.movies-nav-blocked span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.movies-nav-blocked .btn-secondary {
  padding: 4px 12px;
  font-size: 12px;
}

.movies-nav-blocked.hidden,
.youtube-view.yt-mini .movies-nav-blocked,
.youtube-view.yt-fullscreen .movies-nav-blocked {
  display: none;
}
```

- [ ] **Step 4: หน้าเว็บโปรด `movies-home.html`**

```html
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <title>เว็บโปรด</title>
  <style>
    body {
      margin: 0;
      padding: 32px;
      background: #0f172a;
      color: #e5e7eb;
      font-family: 'Prompt', 'Segoe UI', Tahoma, sans-serif;
    }
    h1 { margin: 0 0 6px; font-size: 22px; font-weight: 600; }
    .hint { margin: 0 0 24px; color: #94a3b8; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .card {
      position: relative;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px;
      border-radius: 10px;
      background: #1e293b;
      border: 1px solid #334155;
      color: inherit;
      text-decoration: none;
    }
    .card:hover { border-color: #f59e0b; }
    .badge {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border-radius: 8px;
      background: #f59e0b;
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 18px;
      text-transform: uppercase;
    }
    .text { min-width: 0; }
    .title, .host { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .title { font-size: 14px; font-weight: 500; }
    .host { font-size: 12px; color: #94a3b8; }
    .remove {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 22px;
      height: 22px;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: #94a3b8;
      font-size: 16px;
      line-height: 22px;
      cursor: pointer;
      display: none;
    }
    .card:hover .remove { display: block; }
    .remove:hover { background: #ef4444; color: #fff; }
  </style>
</head>
<body>
  <h1>🎬 เว็บโปรด</h1>
  <p class="hint">พิมพ์ URL หรือคำค้นหาในแถบด้านบน แล้วกด ☆ เพื่อบันทึกเว็บไว้ที่นี่</p>
  <div id="grid" class="grid"></div>
  <script>
    // Favourites come from the app (movies.js) in ?favs=; removing one sets #remove=<url>, which the app handles
    let favs = [];
    try { favs = JSON.parse(new URLSearchParams(location.search).get('favs')) || []; } catch (e) {}
    const grid = document.getElementById('grid');
    for (const fav of favs) {
      let url;
      try { url = new URL(fav.url); } catch (e) { continue; }
      if (!/^https?:$/.test(url.protocol)) continue;
      const host = url.hostname.replace(/^www\./, '');

      const card = document.createElement('a');
      card.className = 'card';
      card.href = url.href;

      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = host.charAt(0);

      const text = document.createElement('div');
      text.className = 'text';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = fav.title || host;
      const hostEl = document.createElement('div');
      hostEl.className = 'host';
      hostEl.textContent = host;
      text.append(title, hostEl);

      const remove = document.createElement('button');
      remove.className = 'remove';
      remove.title = 'ลบออกจากเว็บโปรด';
      remove.textContent = '×';
      remove.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        location.hash = 'remove=' + encodeURIComponent(fav.url);
      });

      card.append(badge, text, remove);
      grid.appendChild(card);
    }
  </script>
</body>
</html>
```

- [ ] **Step 5: `movies.js`**

```js
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
  return hash.startsWith('#remove=') ? decodeURIComponent(hash.slice('#remove='.length)) : null;
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
    moviesReady = Promise.race([
      ipcRenderer.invoke('movies-init').catch(() => ({ ok: false })),
      // Slow network: open the page anyway, blocking switches on as soon as the engine is ready
      new Promise((resolve) => setTimeout(() => resolve({ ok: true }), MOVIES_INIT_TIMEOUT_MS))
    ]).then((result) => {
      if (!result || !result.ok) {
        moviesReady = null; // try again next time the tab opens
        showToast('ยังโหลดตัวบล็อกโฆษณาไม่ได้ จะลองใหม่รอบหน้า');
      }
    });
  }
  return moviesReady;
}

async function toggleMovies() {
  if (!mediaWebviews.movies) await ensureMoviesBlocker();
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
```

- [ ] **Step 6: ตรวจ syntax และเทสต์**

Run: `node --check movies.js && node --check renderer.js && npm test`
Expected: ไม่มี error

- [ ] **Step 7: ลองในแอปจริง**

Run: `npm start` แล้ว:
- กดปุ่ม "หนัง" → toast เตรียมตัวบล็อก → หน้าเว็บโปรดว่าง มีคำแนะนำ, หัว media view มีแถบ URL แทนชื่อ
- พิมพ์ `example.com` Enter → เปิด `https://example.com/` แถบ URL อัปเดต
- พิมพ์ `หนังใหม่` Enter → ไปหน้าค้นหา Google และกดผลค้นหาไปเว็บอื่นได้ (ไม่มีแถบบล็อก)
- กด ⭐ → toast บันทึก, ดาวเต็ม → กด 🏠 → มีการ์ด → กด × บนการ์ด → การ์ดหาย
- เปิด YouTube → แถบ URL หาย ชื่อ "YouTube ไม่มีโฆษณา" กลับมา
- `Ctrl+Shift+M` ตอนโฟกัสอยู่ในแชท → เปิด/ซ่อนแท็บหนังได้
- ปิดแท็บหนัง (×) แล้วเปิดใหม่ → กลับมาหน้าเดิม

- [ ] **Step 8: Commit**

```bash
git add movies.js movies-home.html renderer.js index.html styles.css
git commit -m "feat: movies tab with address bar, favourites and redirect notice"
```

---

### Task 7: แพ็กแอปและทดสอบทั้งระบบ

**Files:**
- Modify: `package.json` (`build.files`)

- [ ] **Step 1: เพิ่มไฟล์ใหม่และ dependency ลง `build.files`**

ใน `package.json` ส่วน `"build"` → `"files"` เพิ่มหลัง `"default-snippets.json",`:

```json
      "movies.js",
      "movies-util.js",
      "movies-home.html",
      "movie-adblock.js",
      "movies-guard.js",
      "media-frames.js",
```

และเพิ่มหลัง `"node_modules/@fontsource/prompt/**/*",`:

```json
      "node_modules/@ghostery/**/*",
      "node_modules/@remusao/**/*",
      "node_modules/tldts/**/*",
      "node_modules/tldts-core/**/*",
      "node_modules/tldts-experimental/**/*",
```

(รายการนี้มาจาก `npm ls --all --omit=dev` ของ `@ghostery/adblocker-electron@2.20.3` + `tldts@7`)

- [ ] **Step 2: build และตรวจว่าไฟล์อยู่ใน asar**

Run: `npm run dist`
Expected: build สำเร็จ ได้ `dist/Multi-Chat-Messenger-Setup-1.0.0.exe`

Run: `npx @electron/asar list dist/win-unpacked/resources/app.asar | grep -E "movies|media-frames|movie-adblock|@ghostery/adblocker-electron-preload|tldts-core|@remusao/smaz" | head -20`
Expected: เจอไฟล์ใหม่ทั้ง 6 ไฟล์ และโฟลเดอร์ `@ghostery/adblocker-electron-preload`, `tldts-core`, `@remusao/smaz`

- [ ] **Step 3: เปิดแอปที่ build แล้วลองแท็บหนัง**

Run: `dist/win-unpacked/Multi-Chat\ Messenger.exe`
Expected: กดปุ่มหนังแล้วเปิดได้ ไม่มี error `Cannot find module` (ถ้ามี ให้เพิ่มแพ็กเกจที่ error บอกลง `build.files` แล้ว build ใหม่)

- [ ] **Step 4: checklist ทั้งระบบ (จาก spec ส่วนที่ 6)**

- [ ] เปิดเว็บหนังที่มีโฆษณาเยอะ 2–3 เว็บ: ไม่มีกล่องโฆษณาและป๊อปอัป กดเล่นแล้วไม่โดนพาไปเว็บอื่น
- [ ] เว็บพาไปโดเมนอื่น: แถบ "บล็อกไว้: เว็บพยายามพาไป ..." ขึ้น, [ไปต่อ] พาไปจริง, หายเองใน 8 วินาที
- [ ] วิดีโอใน iframe: ลอย PiP, กรอ ±10 วินาที, "กลับไปที่แท็บ", mini player เห็นแค่วิดีโอ, ปุ่มเล่น/หยุดใน mini, เต็มจอ
- [ ] เล่นหนังแล้วกดแท็บแชท → ลอยเอง
- [ ] แถบ URL, ← →, เว็บโปรด (เพิ่ม/ลบ/เปิด), ปิดแล้วเปิดกลับมาหน้าเดิม
- [ ] YouTube และ TikTok ยังลอย กรอ และ mini player ได้เหมือนเดิม
- [ ] แชทปกติ, ดู RAM ใน Task Manager ตอนยังไม่เปิดแท็บหนังเทียบกับ `main` ก่อนแก้: ไม่เพิ่มอย่างมีนัยสำคัญ
- [ ] ปิดเน็ตแล้วลบ `adblock-engine.bin` → เปิดแท็บหนัง: toast "ยังโหลดตัวบล็อกโฆษณาไม่ได้ จะลองใหม่รอบหน้า" และหน้าเว็บโปรดยังเปิดได้

ถ้า "กลับไปที่แท็บ" จาก PiP ของวิดีโอใน iframe ไม่ทำงาน (`sendToHost` จาก subframe ไม่ถึง webview) ให้บันทึกไว้เป็นข้อจำกัดใน PR ไม่ต้องแก้ในงานนี้: PiP ยังใช้ได้ แค่ต้องกดปุ่มหนังเพื่อกลับ

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "build: package the movies tab and its ad blocker"
```
