const { clipboard, ipcRenderer } = require('electron');

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
          </div>
          <div class="pane-controls">
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
  isGridView = false;
  activeAccountId = accId;
  updateLayoutView();
}

btnModeGrid.addEventListener('click', () => {
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
  const newAccount = {
    id: newId,
    name: name,
    platform: platform,
    partition: `persist:account_${newId}`,
    url: targetUrl
  };

  accounts.push(newAccount);
  saveAccounts(accounts);

  accountModal.classList.add('hidden');
  initAccounts();
  showToast(`เพิ่ม "${name}" (${PLATFORM_CONFIG[platform]?.name || 'Web'}) เรียบร้อยแล้ว!`);
});

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
  if (wv) wv.loadURL('https://www.messenger.com/');
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

const DEFAULT_SNIPPETS = [
  {
    id: 1,
    title: 'เลขบัญชี กสิกรไทย',
    tag: 'bank',
    tagText: 'บัญชีธนาคาร',
    tagIcon: 'fa-building-columns',
    content: 'โอนเงินผ่านบัญชี ธนาคารกสิกรไทย\nเลขบัญชี: 123-4-56789-0\nชื่อบัญชี: บจก. ขายดี มีโชค\nโอนแล้วแจ้งสลิปได้เลยครับ 🙏'
  },
  {
    id: 2,
    title: 'ข้อความต้อนรับลูกค้า',
    tag: 'welcome',
    tagText: 'ทักทาย',
    tagIcon: 'fa-hand-wave',
    content: 'สวัสดีครับยินดีต้อนรับครับ 😊 สินค้ามีพร้อมส่งทุกรายการ สามารถสอบถามรายละเอียดเพิ่มเติมหรือแจ้งรายการที่สนใจได้เลยครับ!'
  },
  {
    id: 3,
    title: 'รอบการจัดส่งสินค้า',
    tag: 'shipping',
    tagText: 'การจัดส่ง',
    tagIcon: 'fa-truck-fast',
    content: 'จัดส่งสินค้าวันถัดไปหลังจากได้รับยอดโอนครับ 🚚 ตัดรอบส่ง 14:00 น. จัดส่งโดย Flash Express / KERRY ครับ'
  },
  {
    id: 4,
    title: 'ขอชื่อ-ที่อยู่ จัดส่ง',
    tag: 'info',
    tagText: 'ขอที่อยู่',
    tagIcon: 'fa-location-dot',
    content: 'รบกวนขอ ชื่อ-ที่อยู่ และเบอร์โทรศัพท์ สำหรับจัดส่งสินค้าด้วยนะครับ 📦✨'
  }
];

function getSnippets() {
  const stored = localStorage.getItem('quick_reply_snippets_v3');
  return stored ? JSON.parse(stored) : DEFAULT_SNIPPETS;
}

function saveSnippets(snippets) {
  localStorage.setItem('quick_reply_snippets_v3', JSON.stringify(snippets));
}

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
  }, 2500);
}

// Initialize App
initAccounts();
renderSnippets();

