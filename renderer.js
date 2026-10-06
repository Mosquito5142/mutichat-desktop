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
            ${acc.id !== 1 ? `<button class="pane-btn" onclick="toggleShareSession(${acc.id})" title="${acc.partition === 'persist:account1' ? '🔗 กำลังแชร์ Cookie กับจอที่ 1 (ไม่ต้องล็อกอินซ้ำ)' : '🔒 แยก Cookie (คลิกเพื่อแชร์ Cookie กับจอที่ 1)'}" id="session-acc-${acc.id}"><i class="fa-solid fa-link" style="${acc.partition === 'persist:account1' ? 'color:#60a5fa;' : 'opacity:0.4;'}"></i></button>` : ''}
            <button class="pane-btn" onclick="toggleAccAutoReply(${acc.id})" title="เปิด/ปิด ตอบกลับอัตโนมัติเฉพาะจอนี้" id="autoreply-acc-${acc.id}"><i class="fa-solid fa-robot"></i></button>
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
    title: 'รับลูกค้าชมรม Heal_Hee',
    content: '📌 รบกวนเช็คเงื่อนไขก่อนสั่งซื้อนะครับ:\n\n1.ลูกค้าต้องกดเข้าชมรม Heal_Hee (ID: 210083)\n\n2.กดเข้ามา 1 สัปดาห์\n\n3.กดส่งของได้สัปดาห์ละ 3 ใบ/ไอดี (เกินกว่านี้ระบบจะไม่ได้รับ)\n\n4.⚠️สำหรับสัปดาห์นี้: สำหรับลูกค้าที่สัปดาห์นี้เคยใช้ "โควต้าส่งออกของชมรมเก่าไปแล้ว" ให้รอส่งไอดีอื่น หรือสลับไอดีอื่นเข้ามาส่งแทนให้ลูกค้าในชมรมใหม่นะครับ ลูกค้าจะไม่เสียสิทธิ์ฟรีในสัปดาห์นี้ครับ 🙏'
  },
  {
    id: 2,
    title: 'รับลูกค้าชมรม Isopheeeee',
    content: '📌 รบกวนเช็คเงื่อนไขก่อนสั่งซื้อนะครับ:\n\n1.ลูกค้าต้องกดเข้าชมรม Isopheeeee (ID: 650039)\n\n2.กดเข้ามา 1 สัปดาห์\n\n3.กดส่งของได้สัปดาห์ละ 3 ใบ/ไอดี (เกินกว่านี้ระบบจะไม่ได้รับ)\n\n4.⚠️สำหรับสัปดาห์นี้: สำหรับลูกค้าที่สัปดาห์นี้เคยใช้ "โควต้าส่งออกของชมรมเก่าไปแล้ว" ให้รอส่งไอดีอื่น หรือสลับไอดีอื่นเข้ามาส่งแทนให้ลูกค้าในชมรมใหม่นะครับ ลูกค้าจะไม่เสียสิทธิ์ฟรีในสัปดาห์นี้ครับ 🙏'
  },
  {
    id: 3,
    title: 'รับลูกค้าชมรม ร้านไก่',
    content: '📌 รบกวนเช็คเงื่อนไขก่อนสั่งซื้อนะครับ:\n\n1.ลูกค้าต้องกดเข้าชมรม ร้านไก่ (ID: 790011)\n\n2.กดเข้ามา 1 สัปดาห์\n\n3.กดส่งของได้สัปดาห์ละ 3 ใบ/ไอดี (เกินกว่านี้ระบบจะไม่ได้รับ)\n\n4.⚠️สำหรับสัปดาห์นี้: สำหรับลูกค้าที่สัปดาห์นี้เคยใช้ "โควต้าส่งออกของชมรมเก่าไปแล้ว" ให้รอส่งไอดีอื่น หรือสลับไอดีอื่นเข้ามาส่งแทนให้ลูกค้าในชมรมใหม่นะครับ ลูกค้าจะไม่เสียสิทธิ์ฟรีในสัปดาห์นี้ครับ 🙏'
  },
  {
    id: 4,
    title: '3 ใบ 90',
    content: 'สรุปยอดเป็น 3 ใบ ราคา 90 บาทนะครับ หากเข้าชมรมเรียบร้อยแล้วทำตามนี้ได้เลยครับ:\n\nส่งไอดีเกมในชมรม\n\nแคปรูปหรือบอกชื่อในเกมแล้วส่งมาให้ด้วยนะครับ (ป้องกันการส่งผิดคนครับ)\n\nบอกโอนพร้อมแนบสลิปได้เลยครับ\n📌 พร้อมเพย์: 0955819489\n👤 ชื่อบัญชี: วรวิทย์ ทิพย์เอี่ยม'
  },
  {
    id: 5,
    title: '3 ใบ 40',
    content: 'สรุปยอดเป็น 3 ใบ ราคา 40 บาทนะครับ หากเข้าชมรมเรียบร้อยแล้วทำตามนี้ได้เลยครับ:\n\nส่งไอดีเกมในชมรม\n\nแคปรูปหรือบอกชื่อในเกมแล้วส่งมาให้ด้วยนะครับ (ป้องกันการส่งผิดคนครับ)\n\nบอกโอนพร้อมแนบสลิปได้เลยครับ\n📌 พร้อมเพย์: 0955819489\n👤 ชื่อบัญชี: วรวิทย์ ทิพย์เอี่ยม'
  },
  {
    id: 6,
    title: 'ส่งของแล้ว',
    content: 'ผมส่งของให้เรียบร้อยแล้วนะครับ รบกวนเช็คดูน้า ขอบคุณที่อุดหนุนครับ! แวะมารับบริการใหม่ได้นะครับ 🙏✨'
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
  }, 1200);
}

// Auto-Reply / Away Mode Elements & Logic
const btnToggleAutoReply = document.getElementById('btn-toggle-auto-reply');
const btnSettingsAutoReply = document.getElementById('btn-settings-auto-reply');
const autoReplyModal = document.getElementById('auto-reply-modal');
const btnCloseAutoReplyModal = document.getElementById('btn-close-auto-reply-modal');
const btnCancelAutoReply = document.getElementById('btn-cancel-auto-reply');
const btnSaveAutoReply = document.getElementById('btn-save-auto-reply');
const toggleAutoReplyActive = document.getElementById('toggle-auto-reply-active');
const inputAutoReplyMessage = document.getElementById('input-auto-reply-message');
const inputAutoReplyCooldown = document.getElementById('input-auto-reply-cooldown');
const awayModeBanner = document.getElementById('away-mode-banner');
const btnBannerOff = document.getElementById('btn-banner-off');

const DEFAULT_AWAY_MESSAGE = `ตอนนี้ผมไม่ได้อยู่หน้าจอนะครับถ้าสนใจซื้อด่วนติดต่อทางเพจหลักไปได้เลยครับมีแอดมินรอตอบอยู่\nhttps://www.facebook.com/profile.php?id=100063915193327`;

function getAutoReplyConfig() {
  const stored = localStorage.getItem('auto_reply_config_v1');
  if (!stored) {
    return {
      enabled: false,
      message: DEFAULT_AWAY_MESSAGE,
      cooldownMin: 30,
      disabledAccountIds: []
    };
  }
  try {
    const parsed = JSON.parse(stored);
    if (!parsed.disabledAccountIds) parsed.disabledAccountIds = [];
    return parsed;
  } catch (e) {
    return {
      enabled: false,
      message: DEFAULT_AWAY_MESSAGE,
      cooldownMin: 30,
      disabledAccountIds: []
    };
  }
}

function saveAutoReplyConfig(config) {
  localStorage.setItem('auto_reply_config_v1', JSON.stringify(config));
  updateAutoReplyUI();
}

function updateAutoReplyUI() {
  const config = getAutoReplyConfig();
  const disabledIds = config.disabledAccountIds || [];

  if (btnToggleAutoReply) {
    if (config.enabled) {
      btnToggleAutoReply.classList.add('active-away');
      btnToggleAutoReply.setAttribute('title', '🤖 โหมดตอบอัตโนมัติ: เปิดอยู่ (คลิกเพื่อปิด)');
    } else {
      btnToggleAutoReply.classList.remove('active-away');
      btnToggleAutoReply.setAttribute('title', '🤖 เปิด/ปิด โหมดตอบกลับอัตโนมัติ (ไม่อยู่หน้าจอ)');
    }
  }

  // Toggle Away Mode Banner
  if (awayModeBanner) {
    if (config.enabled) {
      awayModeBanner.classList.remove('hidden');
    } else {
      awayModeBanner.classList.add('hidden');
    }
  }

  // Update per-account pane indicators
  const accounts = getAccounts();
  accounts.forEach(acc => {
    const btn = document.getElementById(`autoreply-acc-${acc.id}`);
    if (btn) {
      const isDisabled = disabledIds.includes(acc.id);
      if (!config.enabled) {
        btn.innerHTML = '<i class="fa-solid fa-robot" style="opacity: 0.4; color: #9ca3af;"></i>';
        btn.setAttribute('title', `🤖 โหมดไม่อยู่หน้าจอปิดอยู่ (เปิดที่แถบเมนูด้านบน)`);
        btn.style.borderColor = '#374151';
        btn.style.background = 'transparent';
      } else if (isDisabled) {
        btn.innerHTML = '<i class="fa-solid fa-robot" style="opacity: 0.3; color: #ef4444;"></i>';
        btn.setAttribute('title', `[ยกเว้น] จอ "${acc.name}" ปิดตอบกลับอัตโนมัติอยู่ (คลิกเพื่อเปิด)`);
        btn.style.borderColor = '#ef4444';
        btn.style.background = 'transparent';
      } else {
        btn.innerHTML = '<i class="fa-solid fa-robot" style="color: #34d399;"></i>';
        btn.setAttribute('title', `[ทำงานอยู่] จอ "${acc.name}" เปิดตอบกลับอัตโนมัติอยู่ (คลิกเพื่อปิดเฉพาะจอนี้)`);
        btn.style.borderColor = '#34d399';
        btn.style.background = 'rgba(16, 185, 129, 0.2)';
      }
    }
  });
}

if (btnToggleAutoReply) {
  btnToggleAutoReply.addEventListener('click', () => {
    const config = getAutoReplyConfig();
    config.enabled = !config.enabled;
    saveAutoReplyConfig(config);
    if (config.enabled) {
      showToast('🤖 เปิดโหมดไม่อยู่หน้าจอเรียบร้อยแล้ว (ระบบจะส่งลิงก์เพจหลักให้อัตโนมัติเมื่อมีคนทักมา)');
    } else {
      showToast('ปิดโหมดไม่อยู่หน้าจอแล้ว');
    }
  });
}

if (btnBannerOff) {
  btnBannerOff.addEventListener('click', () => {
    const config = getAutoReplyConfig();
    config.enabled = false;
    saveAutoReplyConfig(config);
    showToast('ปิดโหมดไม่อยู่หน้าจอแล้ว');
  });
}

if (btnSettingsAutoReply) {
  btnSettingsAutoReply.addEventListener('click', openAutoReplyModal);
}

function openAutoReplyModal() {
  const config = getAutoReplyConfig();
  const disabledIds = config.disabledAccountIds || [];

  if (toggleAutoReplyActive) toggleAutoReplyActive.checked = config.enabled;
  if (inputAutoReplyMessage) inputAutoReplyMessage.value = config.message || DEFAULT_AWAY_MESSAGE;
  if (inputAutoReplyCooldown) inputAutoReplyCooldown.value = config.cooldownMin || 30;

  const accountsListEl = document.getElementById('auto-reply-accounts-list');
  if (accountsListEl) {
    accountsListEl.innerHTML = '';
    const accounts = getAccounts();
    accounts.forEach(acc => {
      const isChecked = !disabledIds.includes(acc.id);
      const iconHtml = getPlatformIcon(acc.platform);
      const row = document.createElement('label');
      row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; cursor: pointer; font-size: 13px; color: #e5e7eb; padding: 4px 0;';
      row.innerHTML = `
        <span>${iconHtml} ${escapeHtml(acc.name)}</span>
        <input type="checkbox" class="acc-auto-reply-cb" data-acc-id="${acc.id}" ${isChecked ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: #10b981; cursor: pointer;">
      `;
      accountsListEl.appendChild(row);
    });
  }

  if (autoReplyModal) autoReplyModal.classList.remove('hidden');
}

function closeAutoReplyModal() {
  if (autoReplyModal) autoReplyModal.classList.add('hidden');
}

if (btnCloseAutoReplyModal) btnCloseAutoReplyModal.addEventListener('click', closeAutoReplyModal);
if (btnCancelAutoReply) btnCancelAutoReply.addEventListener('click', closeAutoReplyModal);

if (btnSaveAutoReply) {
  btnSaveAutoReply.addEventListener('click', () => {
    const enabled = toggleAutoReplyActive ? toggleAutoReplyActive.checked : false;
    const message = inputAutoReplyMessage ? inputAutoReplyMessage.value.trim() : DEFAULT_AWAY_MESSAGE;
    const cooldownMin = inputAutoReplyCooldown ? parseInt(inputAutoReplyCooldown.value, 10) || 30 : 30;

    if (!message) {
      alert('กรุณากรอกข้อความตอบกลับอัตโนมัติ');
      return;
    }

    const disabledAccountIds = [];
    document.querySelectorAll('.acc-auto-reply-cb').forEach(cb => {
      if (!cb.checked) {
        const id = parseInt(cb.getAttribute('data-acc-id'), 10);
        if (id) disabledAccountIds.push(id);
      }
    });

    saveAutoReplyConfig({ enabled, message, cooldownMin, disabledAccountIds });
    closeAutoReplyModal();
    showToast('บันทึกการตั้งค่าโหมดไม่อยู่หน้าจอเรียบร้อยแล้ว!');
  });
}

// Periodic Auto-Reply Execution Engine
setInterval(() => {
  const config = getAutoReplyConfig();
  if (!config.enabled) return;

  const disabledIds = config.disabledAccountIds || [];
  const accounts = getAccounts();

  accounts.forEach(acc => {
    if (disabledIds.includes(acc.id)) return;

    const wv = document.getElementById(`webview-${acc.id}`);
    if (!wv || typeof wv.executeJavaScript !== 'function') return;

    const cooldownMs = (config.cooldownMin || 30) * 60 * 1000;
    const msgText = config.message || DEFAULT_AWAY_MESSAGE;

    const code = `
      (function() {
        try {
          if (!window.__mutichat_replied_map) window.__mutichat_replied_map = {};
          const now = Date.now();
          const cooldownMs = ${cooldownMs};
          const msgText = ${JSON.stringify(msgText)};

          function getThreadName(el) {
            if (!el) return '';
            const bold = el.querySelector('span[style*="font-weight: 600"], span[style*="font-weight: bold"], span[style*="font-weight:700"]');
            if (bold && bold.textContent) return bold.textContent.trim();
            return el.textContent ? el.textContent.trim().substring(0, 30) : '';
          }

          // 1. Scan sidebar for unread items sent by customer
          const rows = document.querySelectorAll('div[role="row"], div[role="gridcell"], div[role="listitem"], a[href*="/t/"], a[href*="/messages/t/"]');
          let unreadRow = null;

          for (const r of rows) {
            const html = r.innerHTML || '';
            const text = r.textContent || '';
            const isUnread = html.includes('var(--accent)') ||
                             html.includes('rgb(0, 132, 255)') ||
                             html.includes('rgb(49, 142, 255)') ||
                             r.querySelector('span[style*="font-weight: 600"], span[style*="font-weight: bold"], span[style*="font-weight:700"]') ||
                             r.querySelector('[aria-label*="Unread"], [aria-label*="ยังไม่ได้อ่าน"]');

            if (isUnread && !text.includes('คุณ:') && !text.includes('You:')) {
              unreadRow = r;
              break;
            }
          }

          // If unread thread exists and is not currently selected:
          if (unreadRow) {
            const isSelected = unreadRow.getAttribute('aria-selected') === 'true' || 
                               unreadRow.classList.contains('selected') || 
                               unreadRow.querySelector('[aria-current="page"]');

            if (!isSelected) {
              const link = unreadRow.tagName.toLowerCase() === 'a' ? unreadRow : (unreadRow.querySelector('a[href]') || unreadRow);
              link.click();
              if (link.dispatchEvent) {
                link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              }
              return { status: 'switching_to_unread' };
            }
          }

          // 2. We are on an open thread. Locate input box
          const inputBox = document.querySelector('div[role="textbox"][contenteditable="true"]') ||
                           document.querySelector('div[contenteditable="true"][aria-label*="Message"]') ||
                           document.querySelector('div[contenteditable="true"][aria-label*="ข้อความ"]') ||
                           document.querySelector('div[contenteditable="true"]') ||
                           document.querySelector('textarea[name="body"]') ||
                           document.querySelector('textarea');

          if (!inputBox) return { status: 'no_input' };

          // Identify thread uniquely by customer name or header
          const activeRow = document.querySelector('div[role="row"][aria-selected="true"], [aria-current="page"]');
          const activeHeader = document.querySelector('div[role="main"] h2, header h2');
          const threadId = activeHeader ? activeHeader.textContent.trim() : (activeRow ? getThreadName(activeRow) : location.href);

          if (!threadId) return { status: 'no_thread_id' };

          const lastSent = window.__mutichat_replied_map[threadId] || 0;
          if (now - lastSent < cooldownMs) {
            return { status: 'cooldown', threadId };
          }

          // SAFETY CHECK 1: Verify active sidebar row preview does NOT show "คุณ:" or "You:"
          if (activeRow) {
            const activeText = activeRow.textContent || '';
            if (activeText.includes('คุณ:') || activeText.includes('You:')) {
              return { status: 'already_replied_by_user', threadId };
            }
          }

          // SAFETY CHECK 2: Check recent messages in open chat
          const msgList = document.querySelector('div[role="main"]') || document.body;
          const allMsgs = msgList.querySelectorAll('div[role="row"], div[aria-label*="ข้อความ"]');
          if (allMsgs.length > 0) {
            const lastMsg = allMsgs[allMsgs.length - 1];
            const lastText = lastMsg.textContent || '';
            if (lastText.includes('ตอนนี้ผมไม่ได้อยู่หน้าจอ') || lastText.includes('https://www.facebook.com/profile.php')) {
              window.__mutichat_replied_map[threadId] = now;
              return { status: 'already_sent_away_msg', threadId };
            }
          }

          // ALL CHECKS PASSED: Safe to send away message to this customer!
          inputBox.focus();

          if (inputBox.tagName.toLowerCase() === 'textarea') {
            inputBox.value = msgText;
            inputBox.dispatchEvent(new Event('input', { bubbles: true }));
            const sendBtn = document.querySelector('input[type="submit"], button[type="submit"], input[name="send"]');
            if (sendBtn) sendBtn.click();
          } else {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(inputBox);
            selection.removeAllRanges();
            selection.addRange(range);

            document.execCommand('insertText', false, msgText);

            if (!inputBox.textContent || !inputBox.textContent.includes('http')) {
              inputBox.textContent = msgText;
              inputBox.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: msgText }));
            }

            setTimeout(() => {
              const enterDown = new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
              });
              inputBox.dispatchEvent(enterDown);

              const enterUp = new KeyboardEvent('keyup', {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
              });
              inputBox.dispatchEvent(enterUp);

              const sendBtn = document.querySelector('div[role="button"][aria-label*="Enter"], div[role="button"][aria-label*="ส่ง"], div[role="button"][aria-label*="Send"], svg[aria-label*="Send"]');
              if (sendBtn) {
                const btn = sendBtn.closest('div[role="button"]') || sendBtn;
                btn.click();
              }
            }, 200);
          }

          window.__mutichat_replied_map[threadId] = now;
          return { status: 'sent', threadId };
        } catch(e) {
          return { status: 'error', err: e.message };
        }
      })();
    `;

    wv.executeJavaScript(code).then(res => {
      if (res && res.status === 'sent') {
        showToast(`🤖 [${acc.name}] ตอบกลับอัตโนมัติโยนไปเพจหลักเรียบร้อยแล้ว!`);
      }
    }).catch(() => {});
  });
}, 2500);

// Initialize App
initAccounts();
renderSnippets();
updateAutoReplyUI();



