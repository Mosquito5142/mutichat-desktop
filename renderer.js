const { clipboard, ipcRenderer } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

// YouTube ad-free + low-resource preload (only attached to YouTube panes)
const YT_PRELOAD_URL = pathToFileURL(path.join(__dirname, 'yt-preload.js')).href;
const YT_PARTITION = 'persist:youtube';
const YT_LAST_URL_KEY = 'yt_last_url';

// DOM Elements
const chatContainer = document.getElementById('chat-container');
const accountTabsBar = document.getElementById('account-tabs-bar');
const btnAddAccount = document.getElementById('btn-add-account');
const btnModeGrid = document.getElementById('btn-mode-grid');
const btnRefreshAll = document.getElementById('btn-refresh-all');

const accountModal = document.getElementById('account-modal');
const btnCloseAccountModal = document.getElementById('btn-close-account-modal');
const btnCancelAccount = document.getElementById('btn-cancel-account');
const btnSaveAccount = document.getElementById('btn-save-account');
const inputAccountName = document.getElementById('input-account-name');

const sellerSidebar = document.getElementById('seller-sidebar');
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
const btnCloseSidebar = document.getElementById('btn-close-sidebar');

const btnAddQuickReply = document.getElementById('btn-add-quick-reply');
const addModal = document.getElementById('add-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelSnippet = document.getElementById('btn-cancel-snippet');
const btnSaveSnippet = document.getElementById('btn-save-snippet');

const inputSnippetTitle = document.getElementById('input-snippet-title');
const inputSnippetContent = document.getElementById('input-snippet-content');
const customSnippetList = document.getElementById('custom-snippet-list');
const toastContainer = document.getElementById('toast-container');

// State Management
let isGridView = true;
let activeAccountId = null;

// Platform Configuration Maps
const PLATFORM_CONFIG = {
  messenger: {
    name: 'Facebook Messenger',
    icon: '<i class="fa-brands fa-facebook-messenger" style="color:#60a5fa;"></i>',
    url: 'https://www.messenger.com/'
  },
  instagram: {
    name: 'Instagram (IG Direct)',
    icon: '<i class="fa-brands fa-instagram" style="color:#f472b6;"></i>',
    url: 'https://www.instagram.com/direct/inbox/'
  },
  tiktok: {
    name: 'TikTok Messages',
    icon: '<i class="fa-brands fa-tiktok" style="color:#38bdf8;"></i>',
    url: 'https://www.tiktok.com/messages'
  },
  line: {
    name: 'LINE Official Account',
    icon: '<i class="fa-brands fa-line" style="color:#4ade80;"></i>',
    url: 'https://chat.line.biz/'
  },
  whatsapp: {
    name: 'WhatsApp Web',
    icon: '<i class="fa-brands fa-whatsapp" style="color:#22c55e;"></i>',
    url: 'https://web.whatsapp.com/'
  },
  shopee: {
    name: 'Shopee Chat',
    icon: '<i class="fa-solid fa-bag-shopping" style="color:#f97316;"></i>',
    url: 'https://seller.shopee.co.th/webchat'
  },
  youtube: {
    name: 'YouTube (ไม่มีโฆษณา)',
    icon: '<i class="fa-brands fa-youtube" style="color:#ef4444;"></i>',
    url: 'https://www.youtube.com/'
  },
  custom: {
    name: 'Custom Web',
    icon: '<i class="fa-solid fa-globe" style="color:#a855f7;"></i>',
    url: 'https://www.google.com'
  }
};

function getPlatformIcon(platformKey) {
  return PLATFORM_CONFIG[platformKey]?.icon || PLATFORM_CONFIG.custom.icon;
}

// Handle Custom URL Group Toggle in Modal
const selectPlatform = document.getElementById('select-account-platform');
const customUrlGroup = document.getElementById('custom-url-group');
const inputAccountUrl = document.getElementById('input-account-url');

if (selectPlatform) {
  selectPlatform.addEventListener('change', () => {
    if (selectPlatform.value === 'custom') {
      customUrlGroup.classList.remove('hidden');
    } else {
      customUrlGroup.classList.add('hidden');
    }
  });
}

// Initial Accounts Setup
const DEFAULT_ACCOUNTS = [
  { id: 1, name: 'FB Messenger 1', platform: 'messenger', partition: 'persist:account1', url: 'https://www.messenger.com/' },
  { id: 2, name: 'FB Messenger 2', platform: 'messenger', partition: 'persist:account2', url: 'https://www.messenger.com/' }
];

function getAccounts() {
  const stored = localStorage.getItem('messenger_accounts_list');
  if (!stored) return DEFAULT_ACCOUNTS;
  
  let list = JSON.parse(stored);
  // Auto-migrate old problematic URLs
  let updated = false;
  list = list.map(acc => {
    if (acc.url === 'https://www.facebook.com/messages/t/' || acc.url.includes('facebook.com/messages/t/')) {
      acc.url = 'https://www.messenger.com/';
      updated = true;
    }
    return acc;
  });
  // YouTube moved out of the grid into its own floating view (login kept: same persist:youtube session)
  if (list.some(acc => acc.platform === 'youtube')) {
    list = list.filter(acc => acc.platform !== 'youtube');
    if (list.length === 0) list = DEFAULT_ACCOUNTS.slice();
    updated = true;
  }
  if (updated) saveAccounts(list);
  return list;
}

function saveAccounts(accounts) {
  localStorage.setItem('messenger_accounts_list', JSON.stringify(accounts));
}

// Render Accounts UI
function initAccounts() {
  const accounts = getAccounts();
  
  // Render Header Tabs
  accountTabsBar.innerHTML = '';
  accounts.forEach(acc => {
    const tab = document.createElement('button');
    tab.className = `acc-tab ${activeAccountId === acc.id && !isGridView ? 'active' : ''}`;
    tab.id = `tab-acc-${acc.id}`;
    tab.onclick = () => focusAccountTab(acc.id);
    
    const iconHtml = getPlatformIcon(acc.platform);

    tab.innerHTML = `
      ${iconHtml}
      <span>${escapeHtml(acc.name)}</span>
      <span id="badge-acc-${acc.id}" class="unread-badge hidden">0</span>
    `;
    accountTabsBar.appendChild(tab);
  });

  // Smart Webview Panes Management — KEEP EXISTING WEBVIEWS ALIVE!
  const currentPaneIds = new Set(accounts.map(a => `pane-acc-${a.id}`));

  // 1. Remove panes of deleted accounts only
  Array.from(chatContainer.children).forEach(child => {
    if (child.id && child.id.startsWith('pane-acc-') && !currentPaneIds.has(child.id)) {
      child.remove();
    }
  });

  // 2. Append existing/new panes in sorted order without destroying webviews
  accounts.forEach((acc) => {
    let pane = document.getElementById(`pane-acc-${acc.id}`);
    
    if (!pane) {
      // Create new pane ONLY if it does not exist yet
      pane = document.createElement('div');
      pane.className = `chat-pane ${activeAccountId === acc.id ? 'active-pane' : ''}`;
      pane.id = `pane-acc-${acc.id}`;
      const iconHtml = getPlatformIcon(acc.platform);

      pane.innerHTML = `
        <div class="pane-header acc1-header" draggable="true" data-acc-id="${acc.id}">
          <div class="acc-info">
            <span class="drag-handle" title="ลากเพื่อเรียงลำดับใหม่"><i class="fa-solid fa-grip-vertical"></i></span>
            <span class="acc-badge acc1-badge">${iconHtml} ${escapeHtml(acc.name)}</span>
            <span id="status-acc-${acc.id}" class="acc-status loading"><i class="fa-solid fa-spinner fa-spin"></i></span>
            <button id="zoom-acc-${acc.id}" class="pane-zoom-badge hidden" onclick="resetPaneZoom(${acc.id})" title="ขนาดตัวอักษรจอนี้ (คลิกเพื่อกลับเป็น 100%) — ปรับด้วย Ctrl + / Ctrl - หรือ Ctrl + ลูกกลิ้งเมาส์"></button>
          </div>
          <div class="pane-controls">
            ${acc.id !== 1 ? `<button class="pane-btn" onclick="toggleShareSession(${acc.id})" title="${acc.partition === 'persist:account1' ? '🔗 กำลังแชร์ Cookie กับจอที่ 1 (ไม่ต้องล็อกอินซ้ำ)' : '🔒 แยก Cookie (คลิกเพื่อแชร์ Cookie กับจอที่ 1)'}" id="session-acc-${acc.id}"><i class="fa-solid fa-link" style="${acc.partition === 'persist:account1' ? 'color:#60a5fa;' : 'opacity:0.4;'}"></i></button>` : ''}
            <button class="pane-btn" onclick="reloadWebview(${acc.id})" title="โหลดใหม่"><i class="fa-solid fa-rotate-right"></i></button>
            <button class="pane-btn" onclick="goHome(${acc.id})" title="หน้าหลัก"><i class="fa-solid fa-house"></i></button>
            <button class="pane-btn" onclick="toggleMute(${acc.id})" title="เปิด/ปิดเสียง" id="mute-acc-${acc.id}"><i class="fa-solid fa-volume-high"></i></button>
            ${accounts.length > 1 ? `<button class="pane-btn danger" onclick="deleteAccount(${acc.id})" title="ลบบัญชีนี้"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
        </div>
        <div class="webview-wrapper">
          <webview 
            id="webview-${acc.id}" 
            src="${acc.url || 'https://www.messenger.com/'}" 
            partition="${acc.partition}"
            useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
            allowpopups>
          </webview>
        </div>
      `;

      // Setup Webview Listeners
      setTimeout(() => {
        const wv = document.getElementById(`webview-${acc.id}`);
        const statusEl = document.getElementById(`status-acc-${acc.id}`);
        if (wv && statusEl) {
          setupWebviewEvents(wv, statusEl, acc.id);
        }
      }, 100);

      // Drag-and-drop on pane header
      const header = pane.querySelector('.pane-header');
      header.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', String(acc.id));
        e.dataTransfer.effectAllowed = 'move';
        pane.classList.add('dragging');
      });
      header.addEventListener('dragend', () => pane.classList.remove('dragging'));

      pane.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        pane.classList.add('drag-over');
      });
      pane.addEventListener('dragleave', () => pane.classList.remove('drag-over'));
      pane.addEventListener('drop', (e) => {
        e.preventDefault();
        pane.classList.remove('drag-over');
        const draggedId = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const targetId = acc.id;
        if (draggedId === targetId) return;

        let accs = getAccounts();
        const fromIdx = accs.findIndex(a => a.id === draggedId);
        const toIdx   = accs.findIndex(a => a.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return;

        const [moved] = accs.splice(fromIdx, 1);
        accs.splice(toIdx, 0, moved);
        saveAccounts(accs);
        initAccounts();
      });
    }

    // Append pane in sorted order without re-creating or reloading webview
    chatContainer.appendChild(pane);
  });

  updateLayoutView();
}

function updateLayoutView() {
  if (isGridView) {
    chatContainer.className = 'chat-container mode-grid';
    btnModeGrid.classList.add('active');
    document.querySelectorAll('.acc-tab').forEach(t => t.classList.remove('active'));

    // Reset inline styles — CSS flex:1 handles equal-width columns automatically
    chatContainer.querySelectorAll('.chat-pane').forEach(p => {
      p.style.height = '';
      p.style.minHeight = '';
      p.style.flex = '';
    });
  } else {
    chatContainer.className = 'chat-container single-pane';
    btnModeGrid.classList.remove('active');

    document.querySelectorAll('.chat-pane').forEach(p => {
      p.classList.remove('active-pane');
      p.style.height = '';
      p.style.flex = '';
    });
    document.querySelectorAll('.acc-tab').forEach(t => t.classList.remove('active'));

    if (activeAccountId) {
      const activePane = document.getElementById(`pane-acc-${activeAccountId}`);
      const activeTab = document.getElementById(`tab-acc-${activeAccountId}`);
      if (activePane) activePane.classList.add('active-pane');
      if (activeTab) activeTab.classList.add('active');
    }
  }
}

function focusAccountTab(accId) {
  leaveYoutube();
  isGridView = false;
  activeAccountId = accId;
  updateLayoutView();
}

btnModeGrid.addEventListener('click', () => {
  leaveYoutube();
  isGridView = true;
  activeAccountId = null;
  updateLayoutView();
});

// Dynamic Account Modal & Add Account Handler
btnAddAccount.addEventListener('click', () => {
  inputAccountName.value = '';
  accountModal.classList.remove('hidden');
});

btnCloseAccountModal.addEventListener('click', () => accountModal.classList.add('hidden'));
btnCancelAccount.addEventListener('click', () => accountModal.classList.add('hidden'));

btnSaveAccount.addEventListener('click', () => {
  const name = inputAccountName.value.trim();
  const platform = selectPlatform.value;
  const sessionChoice = document.getElementById('select-account-session')?.value || 'shared_main';
  let targetUrl = PLATFORM_CONFIG[platform]?.url || 'https://www.google.com';

  if (platform === 'custom') {
    const customUrl = inputAccountUrl.value.trim();
    if (!customUrl) {
      alert('กรุณากรอก URL เว็บไซต์ที่ต้องการเปิด');
      return;
    }
    targetUrl = customUrl.startsWith('http') ? customUrl : `https://${customUrl}`;
  }

  if (!name) {
    alert('กรุณากรอกชื่อบัญชีที่ต้องการเพิ่ม');
    return;
  }

  const accounts = getAccounts();
  const newId = Date.now();
  const targetPartition = sessionChoice === 'shared_main' ? 'persist:account1' : `persist:account_${newId}`;

  const newAccount = {
    id: newId,
    name: name,
    platform: platform,
    partition: targetPartition,
    url: targetUrl
  };

  accounts.push(newAccount);
  saveAccounts(accounts);

  accountModal.classList.add('hidden');
  initAccounts();
  showToast(`เพิ่ม "${name}" (${PLATFORM_CONFIG[platform]?.name || 'Web'}) เรียบร้อยแล้ว!`);
});

// Toggle Share Session Handler (Fix login loop for same FB account)
function toggleShareSession(accId) {
  if (accId === 1) {
    alert('จอที่ 1 เป็นเซสชันหลัก (Main Session) อยู่แล้วครับ');
    return;
  }
  let accounts = getAccounts();
  const acc = accounts.find(a => a.id === accId);
  if (!acc) return;

  const isSharedNow = (acc.partition === 'persist:account1');

  if (isSharedNow) {
    acc.partition = `persist:account_${acc.id}`;
    saveAccounts(accounts);
    initAccounts();
    showToast(`สลับ "${acc.name}" เป็นแบบสิทธิ์ Cookie แยกอิสระแล้ว`);
  } else {
    acc.partition = 'persist:account1';
    saveAccounts(accounts);
    initAccounts();
    showToast(`🔗 สลับ "${acc.name}" ให้แชร์ Cookie กับจอที่ 1 เรียบร้อยแล้ว! (ไม่ต้องล็อกอินซ้ำอีกต่อไป)`);
  }
}

window.toggleShareSession = toggleShareSession;

// Delete Account Handler
function deleteAccount(accId) {
  let accounts = getAccounts();
  const accToDelete = accounts.find(a => a.id === accId);
  
  if (!accToDelete) return;

  if (confirm(`คุณต้องการลบ "${accToDelete.name}" ออกจากระบบใช่หรือไม่?`)) {
    accounts = accounts.filter(a => a.id !== accId);
    saveAccounts(accounts);
    initAccounts();
    showToast(`ลบบัญชี "${accToDelete.name}" เรียบร้อยแล้ว`);
  }
}

window.deleteAccount = deleteAccount;

// Refresh All Webviews
btnRefreshAll.addEventListener('click', () => {
  const accounts = getAccounts();
  accounts.forEach(acc => reloadWebview(acc.id));
  showToast('รีเฟรชทุกหน้าจอเรียบร้อยแล้ว');
});

// Webview Controls
function reloadWebview(accId) {
  const wv = document.getElementById(`webview-${accId}`);
  if (wv) wv.reload();
}

function goHome(accId) {
  const wv = document.getElementById(`webview-${accId}`);
  const acc = getAccounts().find(a => a.id === accId);
  if (wv) wv.loadURL(acc?.url || 'https://www.messenger.com/');
}

function switchUrl(accId, mode) {
  const wv = document.getElementById(`webview-${accId}`);
  if (!wv) return;

  if (mode === 'mobile') {
    wv.loadURL('https://m.facebook.com/messages');
    showToast(`สลับไปโหมดโมบายล์ (โหลดไวสุด)`);
  } else if (mode === 'desktop') {
    wv.loadURL('https://www.messenger.com/');
    showToast(`สลับไปหน้าหลัก Messenger`);
  }
}

const muteStateMap = {};

function toggleMute(accId) {
  const wv = document.getElementById(`webview-${accId}`);
  const btn = document.getElementById(`mute-acc-${accId}`);
  
  muteStateMap[accId] = !muteStateMap[accId];
  if (wv) wv.setAudioMuted(muteStateMap[accId]);
  
  if (btn) {
    btn.innerHTML = muteStateMap[accId] ? '<i class="fa-solid fa-volume-xmark"></i>' : '<i class="fa-solid fa-volume-high"></i>';
  }
  showToast(muteStateMap[accId] ? 'ปิดเสียงแล้ว' : 'เปิดเสียงแล้ว');
}

window.switchUrl = switchUrl;
window.reloadWebview = reloadWebview;
window.goHome = goHome;
window.toggleMute = toggleMute;

// Setup Webview Listeners
function setupWebviewEvents(wv, statusEl, accId) {
  // Re-apply this pane's saved zoom on every page load (and now, in case the page is already up)
  const applySavedZoom = () => applyPaneZoom(accId, getAccounts().find(a => a.id === accId)?.zoom || 0);
  wv.addEventListener('dom-ready', applySavedZoom);
  applySavedZoom();

  wv.addEventListener('did-start-loading', () => {
    statusEl.className = 'acc-status loading';
    statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลด...';
  });

  wv.addEventListener('did-stop-loading', () => {
    statusEl.className = 'acc-status ready';
    statusEl.innerHTML = '<i class="fa-solid fa-check"></i> พร้อมใช้งาน';
  });

  wv.addEventListener('page-title-updated', (e) => {
    const unreadMatch = e.title && e.title.match(/\((\d+)\)/);
    const badgeEl = document.getElementById(`badge-acc-${accId}`);
    const unreadCount = unreadMatch ? parseInt(unreadMatch[1], 10) : 0;
    if (unreadCount > (lastUnreadMap[accId] || 0)) notifyYoutubeOverlay(accId, unreadCount);
    lastUnreadMap[accId] = unreadCount;
    
    if (unreadMatch && parseInt(unreadMatch[1], 10) > 0) {
      const count = unreadMatch[1];
      statusEl.innerHTML = `<i class="fa-solid fa-bell text-warning"></i> มีแชทใหม่ (${count})`;
      if (badgeEl) {
        badgeEl.textContent = count;
        badgeEl.classList.remove('hidden');
      }
      ipcRenderer.send('flash-taskbar');
    } else if (badgeEl) {
      badgeEl.classList.add('hidden');
    }
  });

  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode !== -3) {
      statusEl.className = 'acc-status loading';
      statusEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ไม่สามารถโหลดได้';
    }
  });
}

// ===== YouTube Floating View (ad-free) =====
// Lives on top of the chat area instead of taking a grid column.
// Modes: closed (no webview) | full (over the chat area) | mini (small draggable player, keeps playing)
//        | hidden (paused, used when leaving a non-video page). Close = destroy webview (frees all its RAM).
const youtubeView = document.getElementById('youtube-view');
const youtubeHost = document.getElementById('youtube-webview-host');
const ytMiniOverlay = document.getElementById('yt-mini-overlay');
const btnYoutube = document.getElementById('btn-youtube');
const YT_MINI_POS_KEY = 'yt_mini_pos';
const YT_MINI_SIZE_KEY = 'yt_mini_width';
const YT_MINI_MARGIN = 16;
const YT_MINI_MIN_WIDTH = 240;
const YT_MINI_DEFAULT_WIDTH = 384;
const lastUnreadMap = {};
let ytWebview = null;
let ytMode = 'closed';

// webview.send throws until the guest page has fired dom-ready
function sendToYoutube(channel, ...args) {
  try { if (ytWebview) ytWebview.send(channel, ...args); } catch (e) {}
}

function isYoutubeVisible() {
  return ytMode === 'full';
}

function setYoutubeMode(mode) {
  ytMode = mode;
  youtubeView.classList.toggle('hidden', mode === 'closed' || mode === 'hidden' || mode === 'pip');
  youtubeView.classList.toggle('yt-mini', mode === 'mini');
  if (mode !== 'full') youtubeView.classList.remove('yt-fullscreen');
  if (mode === 'mini') placeMiniPlayer();
  else {
    youtubeView.style.left = '';
    youtubeView.style.top = '';
    youtubeView.style.width = '';
    youtubeView.style.height = '';
  }
  sendToYoutube('mc-mini', mode === 'mini');
  btnYoutube.classList.toggle('active', mode === 'full');
  btnYoutube.classList.toggle('yt-alive', mode === 'mini' || mode === 'hidden' || mode === 'pip');
}

// ===== Picture-in-Picture: Chromium's own floating video window (stays on top of every app, like Chrome) =====
const PIP_VIDEO = `document.querySelector('#movie_player video')`;

async function enterPip() {
  if (!ytWebview) return false;
  try {
    // userGesture=true: Chromium only opens PiP in response to a user action
    return await ytWebview.executeJavaScript(
      `(() => { const v = ${PIP_VIDEO}; if (!v || !document.pictureInPictureEnabled) return false;
        return v.requestPictureInPicture().then(() => true, () => false); })()`, true);
  } catch (e) {
    return false;
  }
}

function exitPip() {
  if (!ytWebview) return Promise.resolve();
  return ytWebview.executeJavaScript(
    `document.pictureInPictureElement ? document.exitPictureInPicture().catch(() => {}) : null`).catch(() => {});
}

// Pop the clip out of the app on demand (button on the YouTube bar / mini player)
async function popOutYoutube() {
  if (!ytWebview) return;
  if (await enterPip()) setYoutubeMode('pip');
  else showToast('เครื่องนี้เปิดหน้าต่างลอยไม่ได้ ใช้จอเล็กในโปรแกรมแทน');
}

function openYoutube() {
  if (!ytWebview) {
    let startUrl = PLATFORM_CONFIG.youtube.url;
    try { startUrl = localStorage.getItem(YT_LAST_URL_KEY) || startUrl; } catch (e) {}

    ytWebview = document.createElement('webview');
    ytWebview.setAttribute('partition', YT_PARTITION);
    ytWebview.setAttribute('preload', YT_PRELOAD_URL);
    ytWebview.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    ytWebview.setAttribute('src', startUrl);

    ytWebview.addEventListener('ipc-message', (e) => {
      if (e.channel === 'mc-open-chat') {
        const accId = e.args[0];
        if (getAccounts().some(a => a.id === accId)) focusAccountTab(accId);
        else leaveYoutube();
      } else if (e.channel === 'mc-pip-return' && ytMode === 'pip') {
        // "Back to tab" in the PiP window: bring the app up and keep watching here
        ipcRenderer.send('focus-window');
        openYoutube();
      } else if (e.channel === 'mc-pip-closed' && ytMode === 'pip') {
        setYoutubeMode('hidden');
      }
    });
    // Fill the whole window (over the top bar) while the video is fullscreen
    ytWebview.addEventListener('enter-html-full-screen', () => youtubeView.classList.add('yt-fullscreen'));
    ytWebview.addEventListener('leave-html-full-screen', () => youtubeView.classList.remove('yt-fullscreen'));
    // Keep the "video only" layout across page loads while mini
    ytWebview.addEventListener('dom-ready', () => sendToYoutube('mc-mini', ytMode === 'mini'));

    youtubeHost.appendChild(ytWebview);
  }
  if (ytMode === 'pip') exitPip();
  setYoutubeMode('full');
}

function isWatchingVideo() {
  try {
    const { pathname } = new URL(ytWebview.getURL());
    return pathname === '/watch' || pathname.startsWith('/shorts/') || pathname.startsWith('/live/');
  } catch (e) {
    return false;
  }
}

// Going to the chats: keep a clip playing in a floating window (in-app mini player if PiP fails),
// otherwise just pause and hide
let ytLeaving = false;

async function leaveYoutube() {
  if (ytMode !== 'full' || ytLeaving) return;
  if (isWatchingVideo()) {
    ytLeaving = true;
    const inPip = await enterPip();
    ytLeaving = false;
    if (ytMode !== 'full') return; // user already moved on (e.g. closed YouTube)
    setYoutubeMode(inPip ? 'pip' : 'mini');
  } else {
    sendToYoutube('mc-pause');
    setYoutubeMode('hidden');
  }
}

async function closeYoutube() {
  if (!ytWebview) return;
  const wv = ytWebview;
  if (ytMode === 'pip') await exitPip();
  ytWebview = null;

  // Remember the clip and position so reopening resumes where we left off
  try {
    const url = new URL(wv.getURL());
    if (url.hostname.endsWith('youtube.com')) {
      if (url.pathname === '/watch') {
        const time = await wv.executeJavaScript(`(document.querySelector('#movie_player video') || {}).currentTime || 0`);
        if (time > 5) url.searchParams.set('t', `${Math.floor(time)}s`);
      }
      localStorage.setItem(YT_LAST_URL_KEY, url.href);
    }
  } catch (e) {}

  wv.remove();
  setYoutubeMode('closed');
  showToast('ปิด YouTube แล้ว (คืน RAM) — กดปุ่ม YouTube เพื่อดูต่อจากเดิม');
}

function toggleYoutube() {
  if (ytMode === 'full') leaveYoutube();
  else openYoutube();
}

function youtubeNav(action) {
  if (!ytWebview) return;
  if (action === 'back' && ytWebview.canGoBack()) ytWebview.goBack();
  else if (action === 'forward' && ytWebview.canGoForward()) ytWebview.goForward();
  else if (action === 'home') ytWebview.loadURL(PLATFORM_CONFIG.youtube.url);
}

// --- Mini player: drag anywhere, click to go back to full view ---
function clampMiniPos(left, top) {
  const maxLeft = window.innerWidth - youtubeView.offsetWidth - YT_MINI_MARGIN;
  const maxTop = window.innerHeight - youtubeView.offsetHeight - YT_MINI_MARGIN;
  return {
    left: Math.max(YT_MINI_MARGIN, Math.min(left, maxLeft)),
    top: Math.max(YT_MINI_MARGIN, Math.min(top, maxTop))
  };
}

// Mini player is always 16:9; width is capped so it never outgrows the window
function setMiniWidth(width) {
  const maxWidth = Math.max(YT_MINI_MIN_WIDTH, Math.min(window.innerWidth - YT_MINI_MARGIN * 2, (window.innerHeight - YT_MINI_MARGIN * 2) * 16 / 9));
  const w = Math.round(Math.max(YT_MINI_MIN_WIDTH, Math.min(width, maxWidth)));
  youtubeView.style.width = `${w}px`;
  youtubeView.style.height = `${Math.round(w * 9 / 16)}px`;
  return w;
}

function placeMiniPlayer() {
  let savedWidth = null;
  try { savedWidth = parseInt(localStorage.getItem(YT_MINI_SIZE_KEY), 10); } catch (e) {}
  setMiniWidth(savedWidth || YT_MINI_DEFAULT_WIDTH);

  let pos = null;
  try { pos = JSON.parse(localStorage.getItem(YT_MINI_POS_KEY)); } catch (e) {}
  // Default: bottom-right corner (Infinity gets clamped to the edge)
  const { left, top } = clampMiniPos(pos?.left ?? Infinity, pos?.top ?? Infinity);
  youtubeView.style.left = `${left}px`;
  youtubeView.style.top = `${top}px`;
}

window.addEventListener('resize', () => { if (ytMode === 'mini') placeMiniPlayer(); });

ytMiniOverlay.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.target.closest('button, .yt-mini-resize')) return;
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  const startLeft = youtubeView.offsetLeft;
  const startTop = youtubeView.offsetTop;
  let dragged = false;
  // Chat webviews would swallow mousemove while dragging over them
  document.body.classList.add('mc-dragging');

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragged && Math.hypot(dx, dy) < 5) return;
    dragged = true;
    const { left, top } = clampMiniPos(startLeft + dx, startTop + dy);
    youtubeView.style.left = `${left}px`;
    youtubeView.style.top = `${top}px`;
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.classList.remove('mc-dragging');
    if (dragged) {
      try {
        localStorage.setItem(YT_MINI_POS_KEY, JSON.stringify({ left: youtubeView.offsetLeft, top: youtubeView.offsetTop }));
      } catch (err) {}
    } else {
      openYoutube();
    }
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

// Resize by dragging a corner; the opposite corner stays put
ytMiniOverlay.querySelectorAll('.yt-mini-resize').forEach((handle) => {
  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const corner = handle.dataset.corner; // tl | tr | bl | br
    const fromLeft = corner.includes('l');
    const fromTop = corner.includes('t');
    const startX = e.clientX;
    const startY = e.clientY;
    const start = youtubeView.getBoundingClientRect();
    document.body.classList.add('mc-dragging', 'mc-resizing');

    const onMove = (ev) => {
      const dx = (ev.clientX - startX) * (fromLeft ? -1 : 1);
      const dy = (ev.clientY - startY) * (fromTop ? -1 : 1);
      // Follow whichever direction the mouse moved more (in 16:9 terms)
      let width = setMiniWidth(start.width + Math.max(dx, dy * 16 / 9));
      let left = fromLeft ? start.right - width : start.left;
      let top = fromTop ? start.bottom - width * 9 / 16 : start.top;
      // Stop growing past the window edge on the side being dragged
      const overX = fromLeft ? YT_MINI_MARGIN - left : left + width - (window.innerWidth - YT_MINI_MARGIN);
      const overY = fromTop ? YT_MINI_MARGIN - top : top + width * 9 / 16 - (window.innerHeight - YT_MINI_MARGIN);
      const over = Math.max(0, overX, overY * 16 / 9);
      if (over > 0) {
        width = setMiniWidth(width - over);
        left = fromLeft ? start.right - width : start.left;
        top = fromTop ? start.bottom - width * 9 / 16 : start.top;
      }
      youtubeView.style.left = `${Math.round(left)}px`;
      youtubeView.style.top = `${Math.round(top)}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('mc-dragging', 'mc-resizing');
      try {
        localStorage.setItem(YT_MINI_SIZE_KEY, String(youtubeView.offsetWidth));
        localStorage.setItem(YT_MINI_POS_KEY, JSON.stringify({ left: youtubeView.offsetLeft, top: youtubeView.offsetTop }));
      } catch (err) {}
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
});

document.getElementById('btn-yt-mini-play').addEventListener('click', () => {
  sendToYoutube('mc-toggle-play');
});
document.getElementById('btn-yt-mini-close').addEventListener('click', closeYoutube);

// New chat while watching → card on top of the video (drawn inside the YouTube page so it shows in fullscreen too)
function notifyYoutubeOverlay(accId, count) {
  if (!isYoutubeVisible()) return;
  const acc = getAccounts().find(a => a.id === accId);
  if (!acc) return;
  sendToYoutube('mc-notify', {
    accId,
    name: acc.name,
    platform: PLATFORM_CONFIG[acc.platform]?.name || 'แชท',
    count
  });
}

btnYoutube.addEventListener('click', toggleYoutube);
document.getElementById('btn-yt-back').addEventListener('click', () => youtubeNav('back'));
document.getElementById('btn-yt-forward').addEventListener('click', () => youtubeNav('forward'));
document.getElementById('btn-yt-home').addEventListener('click', () => youtubeNav('home'));
document.getElementById('btn-yt-close').addEventListener('click', closeYoutube);
document.getElementById('btn-yt-popout').addEventListener('click', popOutYoutube);
document.getElementById('btn-yt-mini-popout').addEventListener('click', popOutYoutube);
// Ctrl+Shift+Y works even while a webview has focus (forwarded from main process)
ipcRenderer.on('toggle-youtube', toggleYoutube);

// ===== Per-pane zoom (Ctrl + / Ctrl - / Ctrl 0 / Ctrl + wheel), remembered per account =====
const ZOOM_STEP = 0.5;
const ZOOM_MIN = -3;
const ZOOM_MAX = 4;

function applyPaneZoom(accId, level) {
  const wv = document.getElementById(`webview-${accId}`);
  if (!wv) return;
  try { wv.setZoomLevel(level); } catch (e) {}
  const badge = document.getElementById(`zoom-acc-${accId}`);
  if (badge) {
    badge.textContent = `${Math.round(Math.pow(1.2, level) * 100)}%`;
    badge.classList.toggle('hidden', level === 0);
  }
}

function getPaneHost(accId) {
  try { return new URL(document.getElementById(`webview-${accId}`).getURL()).host; } catch (e) { return null; }
}

function setPaneZoom(accId, level) {
  const accounts = getAccounts();
  const acc = accounts.find(a => a.id === accId);
  if (!acc) return;
  // Chromium shares zoom between panes on the same cookie session + website,
  // so keep those linked panes' saved value and badge in step
  const host = getPaneHost(accId);
  accounts.forEach(other => {
    if (other.id === accId || (other.partition === acc.partition && host && getPaneHost(other.id) === host)) {
      other.zoom = level;
      applyPaneZoom(other.id, level);
    }
  });
  saveAccounts(accounts);
}

function resetPaneZoom(accId) {
  setPaneZoom(accId, 0);
}
window.resetPaneZoom = resetPaneZoom;

ipcRenderer.on('zoom-pane', (_event, webContentsId, action) => {
  const wv = [...document.querySelectorAll('webview')].find(w => {
    try { return w.getWebContentsId() === webContentsId; } catch (e) { return false; }
  });
  if (!wv) return;

  const current = wv.getZoomLevel();
  const next = action === 'reset' ? 0
    : Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, current + (action === 'in' ? ZOOM_STEP : -ZOOM_STEP)));

  const accMatch = wv.id.match(/^webview-(\d+)$/);
  if (accMatch) setPaneZoom(parseInt(accMatch[1], 10), next);
  else wv.setZoomLevel(next); // YouTube: zoom for this session only
});

// Seller Sidebar Toggle
btnToggleSidebar.addEventListener('click', () => sellerSidebar.classList.toggle('open'));
btnCloseSidebar.addEventListener('click', () => sellerSidebar.classList.remove('open'));

// Refresh All Webviews
btnRefreshAll.addEventListener('click', () => {
  const accounts = getAccounts();
  accounts.forEach(acc => reloadWebview(acc.id));
  showToast('รีเฟรชทุกหน้าจอเรียบร้อยแล้ว');
});

// Quick Reply Snippets Logic (Full CRUD: Add, Edit, Delete, Copy)
const inputSnippetId = document.getElementById('input-snippet-id');
const modalSnippetTitleText = document.getElementById('modal-snippet-title-text');
const snippetList = document.getElementById('snippet-list');

// Default Quick Replies ship with every build — edit default-snippets.json to change them
const DEFAULT_SNIPPETS = require('./default-snippets.json');

function getSnippets() {
  const stored = localStorage.getItem('quick_reply_snippets_v3');
  return stored ? JSON.parse(stored) : DEFAULT_SNIPPETS;
}

function saveSnippets(snippets) {
  localStorage.setItem('quick_reply_snippets_v3', JSON.stringify(snippets));
}

// Export / Import — same format as default-snippets.json, so an export can replace it before building
const btnExportSnippets = document.getElementById('btn-export-snippets');
const btnImportSnippets = document.getElementById('btn-import-snippets');
const inputImportSnippets = document.getElementById('input-import-snippets');

btnExportSnippets.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(getSnippets(), null, 2) + '\n'], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'default-snippets.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
});

btnImportSnippets.addEventListener('click', () => inputImportSnippets.click());

inputImportSnippets.addEventListener('change', async () => {
  const file = inputImportSnippets.files[0];
  inputImportSnippets.value = '';
  if (!file) return;

  let list;
  try {
    list = JSON.parse(await file.text());
  } catch (e) {
    list = null;
  }
  const isValid = Array.isArray(list) && list.length > 0 &&
    list.every(item => item && typeof item.title === 'string' && typeof item.content === 'string');
  if (!isValid) {
    alert('ไฟล์ไม่ถูกต้อง: ต้องเป็นไฟล์ข้อความตอบด่วนที่ส่งออกจากโปรแกรมนี้');
    return;
  }
  if (!confirm(`นำเข้าข้อความตอบด่วน ${list.length} รายการ? (จะแทนที่ข้อความที่มีอยู่ทั้งหมด)`)) return;

  saveSnippets(list.map((item, i) => ({ id: Date.now() + i, title: item.title, content: item.content })));
  renderSnippets();
  showToast(`นำเข้าข้อความตอบด่วน ${list.length} รายการเรียบร้อยแล้ว`);
});

// Copy Snippet Logic
function copySnippet(btnElement) {
  const card = btnElement.closest('.snippet-card');
  let textToCopy = card.getAttribute('data-text');
  textToCopy = textToCopy.replace(/\\n/g, '\n');
  clipboard.writeText(textToCopy);
  showToast('คัดลอกข้อความแล้ว! พร้อมกด Ctrl+V วางในแชท');
}

window.copySnippet = copySnippet;

// Open Add Snippet Modal
btnAddQuickReply.addEventListener('click', () => {
  inputSnippetId.value = '';
  inputSnippetTitle.value = '';
  inputSnippetContent.value = '';
  modalSnippetTitleText.innerHTML = '<i class="fa-solid fa-plus-circle text-primary"></i> เพิ่มข้อความตอบด่วนใหม่';
  addModal.classList.remove('hidden');
});

btnCloseModal.addEventListener('click', () => addModal.classList.add('hidden'));
btnCancelSnippet.addEventListener('click', () => addModal.classList.add('hidden'));

// Open Edit Snippet Modal
function editSnippet(id) {
  const snippets = getSnippets();
  const target = snippets.find(s => s.id === id);
  if (!target) return;

  inputSnippetId.value = target.id;
  inputSnippetTitle.value = target.title;
  inputSnippetContent.value = target.content;
  modalSnippetTitleText.innerHTML = '<i class="fa-solid fa-pen-to-square text-primary"></i> แก้ไขข้อความตอบด่วน';
  addModal.classList.remove('hidden');
}

window.editSnippet = editSnippet;

// Save Snippet (Create or Update)
btnSaveSnippet.addEventListener('click', () => {
  const idStr = inputSnippetId.value;
  const title = inputSnippetTitle.value.trim();
  const content = inputSnippetContent.value.trim();

  if (!title || !content) {
    alert('กรุณากรอกทั้งหัวข้อและข้อความให้ครบถ้วน');
    return;
  }

  let snippets = getSnippets();

  if (idStr) {
    // Update existing snippet
    const id = parseInt(idStr, 10);
    snippets = snippets.map(s => {
      if (s.id === id) {
        return { ...s, title, content };
      }
      return s;
    });
    showToast(`แก้ไขข้อความ "${title}" เรียบร้อยแล้ว`);
  } else {
    // Add new snippet
    const newSnippet = {
      id: Date.now(),
      title,
      content,
      tag: 'custom',
      tagText: 'ข้อความด่วน',
      tagIcon: 'fa-star'
    };
    snippets.push(newSnippet);
    showToast(`เพิ่มข้อความ "${title}" เรียบร้อยแล้ว`);
  }

  saveSnippets(snippets);
  addModal.classList.add('hidden');
  renderSnippets();
});

// Delete Snippet
function deleteSnippet(id) {
  let snippets = getSnippets();
  const target = snippets.find(s => s.id === id);
  if (!target) return;

  if (confirm(`คุณต้องการลบข้อความ "${target.title}" ใช่หรือไม่?`)) {
    snippets = snippets.filter(s => s.id !== id);
    saveSnippets(snippets);
    renderSnippets();
    showToast('ลบข้อความตอบด่วนเรียบร้อยแล้ว');
  }
}

window.deleteSnippet = deleteSnippet;

// Render Snippets List (no tag badges — cleaner look)
function renderSnippets() {
  if (!snippetList) return;
  snippetList.innerHTML = '';

  const snippets = getSnippets();

  snippets.forEach(item => {
    const card = document.createElement('div');
    card.className = 'snippet-card';
    const escapedText = item.content.replace(/"/g, '&quot;').replace(/\n/g, '\\n');
    card.setAttribute('data-text', escapedText);

    card.innerHTML = `
      <div class="snippet-top">
        <div class="snippet-title">${escapeHtml(item.title)}</div>
        <div style="display: flex; gap: 4px; flex-shrink:0;">
          <button class="copy-btn" onclick="copySnippet(this)" title="ก๊อปปี้ข้อความ"><i class="fa-solid fa-copy"></i> ก๊อปปี้</button>
          <button class="copy-btn" style="background:#374151;" onclick="editSnippet(${item.id})" title="แก้ไข"><i class="fa-solid fa-pen"></i></button>
          <button class="copy-btn" style="background:#ef4444;" onclick="deleteSnippet(${item.id})" title="ลบ"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      <div class="snippet-preview">${escapeHtml(item.content)}</div>
    `;

    snippetList.appendChild(card);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${message}`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 1200);
}

// Initialize App
initAccounts();
renderSnippets();
// Auto-reply (away mode) was removed — drop its leftover settings
localStorage.removeItem('auto_reply_config_v1');



