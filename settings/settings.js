/**
 * ForgeTabs — Settings Page Logic
 */

import { getSettings, saveSettings, getSessions, deleteSession, getStats } from '../utils/storage.js';
import {
  autoGroupByDomain, ungroupAllTabs, closeDuplicateTabs,
  closeInactiveTabs, hibernateTabs, BUILTIN_CATEGORIES, tabMatchesCategory
} from '../utils/tabManager.js';
import { importSession } from '../utils/sessionManager.js';
import { customConfirm } from '../utils/ui.js';

// ─── State ────────────────────────────────────────────────
let currentSettings = {};
let isDirty = false;
let importFileData = null;

const SECTION_LABELS = {
  dashboard: { heading: 'Dashboard', desc: 'Welcome back! Here is a summary of your workspace.' },
  general: { heading: 'General Settings', desc: 'Customize your ForgeTabs experience' },
  grouping: { heading: 'Tab Grouping', desc: 'Configure auto-grouping behavior and exclusions' },
  cleanup: { heading: 'Tab Cleanup', desc: 'Manage stale and duplicate tab removal' },
  sessions: { heading: 'Session Management', desc: 'Save, restore, and import tab sessions' },
  notifications: { heading: 'Notifications', desc: 'Control when ForgeTabs sends alerts' },
  data: { heading: 'Data & Storage', desc: 'Manage your saved data and reset settings' },
  about: { heading: 'About ForgeDot Tools', desc: 'Information about ForgeTabs and the developer' },
};

// ─── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Inject real version from manifest
  const { version } = chrome.runtime.getManifest();
  const sidebarVer = document.getElementById('sidebar-version');
  const aboutVer   = document.getElementById('about-version');
  if (sidebarVer) sidebarVer.textContent = `v${version}`;
  if (aboutVer)   aboutVer.textContent   = `Version ${version}`;

  currentSettings = await getSettings();
  populateSettings(currentSettings);
  initNavigation();
  initFormListeners();
  initSaveBar();
  initCleanupActions();
  initDataSection();
  initSessionImport();
  initTabInsights();
  initUnifiedCategories();
  initGroupingWiring();
  
  if (document.querySelector('.nav-item.active[data-section="dashboard"]')) {
    const labels = SECTION_LABELS['dashboard'];
    document.getElementById('section-heading').textContent = labels.heading;
    document.getElementById('section-desc').textContent = labels.desc;
    initDashboard();
    if (tiAllTabs.length === 0) loadTabInsights();
  }
});

// ─── Navigation ────────────────────────────────────────────
function initNavigation() {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      const sectionId = item.dataset.section;
      document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
      document.querySelectorAll('.settings-section').forEach((s) => s.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(`section-${sectionId}`)?.classList.add('active');

      const labels = SECTION_LABELS[sectionId] || {};
      document.getElementById('section-heading').textContent = labels.heading || '';
      document.getElementById('section-desc').textContent = labels.desc || '';
      
      if (sectionId === 'dashboard') {
        initDashboard();
      }
    });
  });
}

// ─── Populate Settings into UI ─────────────────────────────
function populateSettings(s) {
  // Theme
  document.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === s.theme);
  });
  applyTheme(s.theme || 'dark');

  // Toggles
  setToggle('setting-showTabCount', s.showTabCount);
  setToggle('setting-confirmBeforeCleanup', s.confirmBeforeCleanup);
  setToggle('setting-autoGroup', s.autoGroup);
  setToggle('setting-autoGroupOnStartup', s.autoGroupOnStartup);
  setToggle('setting-groupByDomain', s.groupByDomain !== false); // default true
  setToggle('setting-subdomainGrouping', s.subdomainGrouping);
  setToggle('setting-groupSingleTabs', s.groupSingleTabs !== false); // default true
  setToggle('setting-sortTabsAndGroups', s.sortTabsAndGroups !== false); // default true
  setToggle('setting-sortGroupsAlphabetically', s.sortGroupsAlphabetically);
  setToggle('setting-groupCollapseAfterSwitch', s.groupCollapseAfterSwitch);
  setToggle('setting-autoSaveSession', s.autoSaveSession);
  setToggle('setting-notificationsEnabled', s.notificationsEnabled);

  // Number inputs
  setNumber('setting-tabLimitWarning', s.tabLimitWarning);
  setNumber('setting-inactiveDays', s.inactiveDays);

  // Tags Arrays
  sdDomPatterns = [...(s.subdomainDomains || [])];
  excDomPatterns = [...(s.excludedDomains || [])];
  
  if (typeof renderSdTagList === 'function') renderSdTagList();
  if (typeof renderExcTagList === 'function') renderExcTagList();
  if (typeof syncSubdomainChildVisibility === 'function') syncSubdomainChildVisibility();
}

function setToggle(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = !!value;
}

function setNumber(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
}

// ─── Collect Settings from UI ──────────────────────────────
function collectSettings() {
  const theme = document.querySelector('.theme-btn.active')?.dataset.theme || 'dark';

  return {
    theme,
    showTabCount: getToggle('setting-showTabCount'),
    confirmBeforeCleanup: getToggle('setting-confirmBeforeCleanup'),
    autoGroup: getToggle('setting-autoGroup'),
    autoGroupOnStartup: getToggle('setting-autoGroupOnStartup'),
    groupByDomain: getToggle('setting-groupByDomain'),
    subdomainGrouping: getToggle('setting-subdomainGrouping'),
    groupSingleTabs: getToggle('setting-groupSingleTabs'),
    sortTabsAndGroups: getToggle('setting-sortTabsAndGroups'),
    sortGroupsAlphabetically: getToggle('setting-sortGroupsAlphabetically'),
    groupCollapseAfterSwitch: getToggle('setting-groupCollapseAfterSwitch'),
    autoSaveSession: getToggle('setting-autoSaveSession'),
    notificationsEnabled: getToggle('setting-notificationsEnabled'),
    tabLimitWarning: parseInt(document.getElementById('setting-tabLimitWarning')?.value || '20'),
    inactiveDays: parseInt(document.getElementById('setting-inactiveDays')?.value || '7'),
    subdomainDomains: [...sdDomPatterns],
    excludedDomains: [...excDomPatterns],
    categoryOverrides: collectCategoryOverrides(),
    customCategories: collectCustomCategories(),
    categoryOrder: [...localCategoryOrder],
  };
}

function getToggle(id) {
  return document.getElementById(id)?.checked || false;
}

function applyTheme(theme) {
  if (theme === 'system') {
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

// ─── Form Listeners (track dirty state) ────────────────────
function initFormListeners() {
  // Theme buttons
  document.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.theme-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const theme = btn.dataset.theme;
      applyTheme(theme);
      autoSave();
    });
  });

  // All checkboxes
  document.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.addEventListener('change', autoSave);
  });

  // Number inputs
  document.querySelectorAll('.number-input').forEach((el) => {
    el.addEventListener('input', markDirty);
  });

  // Textarea
  document.querySelectorAll('.textarea').forEach((el) => {
    el.addEventListener('input', markDirty);
  });
}

function markDirty() {
  isDirty = true;
  const saveBar = document.getElementById('save-bar');
  if (saveBar) saveBar.style.display = 'flex';
}

async function autoSave() {
  const newSettings = collectSettings();
  await saveSettings(newSettings);
  currentSettings = newSettings;
  isDirty = false;
  const saveBar = document.getElementById('save-bar');
  if (saveBar) saveBar.style.display = 'none';
}

// ─── Save Bar ──────────────────────────────────────────────
function initSaveBar() {
  document.getElementById('btn-save')?.addEventListener('click', async () => {
    const newSettings = collectSettings();
    await saveSettings(newSettings);
    currentSettings = newSettings;
    isDirty = false;
    document.getElementById('save-bar').style.display = 'none';
    const status = document.getElementById('save-status');
    if (status) {
      status.textContent = '✓ Saved';
      status.className = 'save-status saved';
      setTimeout(() => { status.textContent = ''; status.className = 'save-status'; }, 2000);
    }
    showToast('✅ Settings saved!', 'success');
  });

  document.getElementById('btn-discard')?.addEventListener('click', () => {
    populateSettings(currentSettings);
    isDirty = false;
    document.getElementById('save-bar').style.display = 'none';
  });
}

// ─── Cleanup Quick Actions ─────────────────────────────────
function initCleanupActions() {
  const setQaResult = (msg, isError = false) => {
    const el = document.getElementById('qa-result');
    if (el) {
      el.textContent = msg;
      el.style.color = isError ? 'var(--danger)' : 'var(--success)';
    }
  };

  document.getElementById('qa-close-dupes')?.addEventListener('click', async () => {
    const win = await chrome.windows.getLastFocused();
    const count = await closeDuplicateTabs(win?.id);
    setQaResult(count > 0 ? `✅ Closed ${count} duplicate tab(s)` : 'No duplicates found');
  });

  document.getElementById('qa-hibernate')?.addEventListener('click', async () => {
    const win = await chrome.windows.getLastFocused();
    const count = await hibernateTabs(win?.id);
    setQaResult(`💤 Hibernated ${count} tab(s)`);
  });

  document.getElementById('qa-close-inactive')?.addEventListener('click', async () => {
    if (!(await customConfirm('Close all inactive tabs?', 'Cleanup Tabs', 'Close Tabs', true))) return;
    const win = await chrome.windows.getLastFocused();
    const days = parseInt(document.getElementById('setting-inactiveDays')?.value || '7');
    const count = await closeInactiveTabs(win?.id, days);
    setQaResult(count > 0 ? `✅ Closed ${count} inactive tab(s)` : 'No inactive tabs found');
  });

  document.getElementById('qa-ungroup-all')?.addEventListener('click', async () => {
    if (!(await customConfirm('Ungroup all tabs?', 'Ungroup Tabs', 'Ungroup', true))) return;
    const win = await chrome.windows.getLastFocused();
    const count = await ungroupAllTabs(win?.id);
    setQaResult(`Ungrouped ${count} tab(s)`);
  });
}

// ─── Data Section ──────────────────────────────────────────
async function initDataSection() {
  // Load stats
  const sessions = await getSessions();
  const sessionCountEl = document.getElementById('data-session-count');
  if (sessionCountEl) sessionCountEl.textContent = `${sessions.length} session(s)`;

  const activitySizeEl = document.getElementById('data-activity-size');
  if (activitySizeEl) {
    const result = await new Promise((r) => chrome.storage.local.get('tabActivity', r));
    const count = Object.keys(result.tabActivity || {}).length;
    activitySizeEl.textContent = `${count} tab record(s)`;
  }

  // Reset Stats
  document.getElementById('btn-reset-stats')?.addEventListener('click', async () => {
    if (!(await customConfirm('Reset dashboard lifetime stats to zero?', 'Reset Stats', 'Reset', true))) return;
    await chrome.storage.local.remove('extensionStats');
    showToast('Dashboard stats reset', 'success');
    initDashboard();
  });

  // Clear activity
  document.getElementById('btn-clear-activity')?.addEventListener('click', async () => {
    if (!(await customConfirm('Clear tab activity log?', 'Clear Log', 'Clear', true))) return;
    await chrome.storage.local.remove('tabActivity');
    showToast('Activity log cleared', 'success');
    if (activitySizeEl) activitySizeEl.textContent = '0 tab record(s)';
  });

  // Clear sessions
  document.getElementById('btn-clear-sessions')?.addEventListener('click', async () => {
    if (!(await customConfirm('Delete ALL saved sessions? This cannot be undone.', 'Delete Sessions', 'Delete All', true))) return;
    await chrome.storage.local.remove('sessions');
    showToast('All sessions deleted', 'success');
    if (sessionCountEl) sessionCountEl.textContent = '0 session(s)';
  });

  // Reset settings
  document.getElementById('btn-reset-settings')?.addEventListener('click', () => {
    openResetSettingsModal();
  });
}

// ─── Session Import ────────────────────────────────────────
function initSessionImport() {
  const fileInput = document.getElementById('session-file-input');
  const filenameEl = document.getElementById('import-filename');
  const importBtn = document.getElementById('btn-import-session');

  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      filenameEl.textContent = file.name;
      const reader = new FileReader();
      reader.onload = (ev) => {
        importFileData = ev.target.result;
        if (importBtn) importBtn.disabled = false;
      };
      reader.readAsText(file);
    }
  });

  importBtn?.addEventListener('click', async () => {
    if (!importFileData) return;
    try {
      const session = await importSession(importFileData);
      const resultEl = document.getElementById('import-result');
      if (resultEl) resultEl.textContent = `✅ Imported "${session.name}" (${session.tabCount} tabs)`;
      importBtn.disabled = true;
      filenameEl.textContent = 'No file chosen';
      importFileData = null;
      showToast('Session imported!', 'success');
    } catch {
      const resultEl = document.getElementById('import-result');
      if (resultEl) { resultEl.textContent = '❌ Invalid session file'; resultEl.style.color = 'var(--danger)'; }
    }
  });
}

// ─── Toast ─────────────────────────────────────────────────
let toastTimer = null;
function showToast(message, type = '') {
  const toast = document.getElementById('global-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `global-toast show${type ? ` ${type}` : ''}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.classList.remove('show'); }, 3000);
}



function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"'/]/g, (s) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;'
  }[s]));
}

// ─── Tab Insights ─────────────────────────────────────────────

let tiAllTabs = [];       // full snapshot from chrome.tabs.query
let tiDupeUrls = new Set(); // URLs that appear 2+ times
let tiActiveFilter = 'all';
let tiSearchQuery = '';
const INACTIVE_DAYS = 7;

function initTabInsights() {
  // Wire filter buttons
  document.querySelectorAll('.ti-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ti-filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      tiActiveFilter = btn.dataset.filter;
      renderTabList();
      updateBulkBar();
    });
  });

  // Wire search
  document.getElementById('ti-search')?.addEventListener('input', (e) => {
    tiSearchQuery = e.target.value.toLowerCase();
    renderTabList();
  });

  // Refresh button
  document.getElementById('ti-refresh')?.addEventListener('click', () => loadTabInsights());


  // Load when section first becomes visible
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      if (item.dataset.section === 'dashboard' && tiAllTabs.length === 0) {
        loadTabInsights();
      }
    });
  });
}

function setFilter(filter) {
  tiActiveFilter = filter;
  document.querySelectorAll('.ti-filter-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.filter === filter);
  });
  renderTabList();
  updateBulkBar();
}

async function loadTabInsights() {
  const list = document.getElementById('ti-tab-list');
  list.innerHTML = `<div class="ti-loading"><div class="ti-spinner"></div><span>Scanning tabs…</span></div>`;

  try {
    const activity = await new Promise((res) =>
      chrome.storage.local.get('tabActivity', (d) => res(d.tabActivity || {}))
    );
    const groups  = await chrome.tabGroups.query({});
    const groupMap = Object.fromEntries(groups.map((g) => [g.id, g]));

    tiAllTabs = await chrome.tabs.query({});

    // Find duplicate URLs
    const urlCount = {};
    tiAllTabs.forEach((t) => { if (t.url) urlCount[t.url] = (urlCount[t.url] || 0) + 1; });
    tiDupeUrls = new Set(Object.keys(urlCount).filter((u) => urlCount[u] > 1));

    const now = Date.now();
    const cutoff = now - INACTIVE_DAYS * 86400000;

    // Annotate each tab
    tiAllTabs = tiAllTabs.map((t) => {
      const lastActive = activity[t.id] || t.lastAccessed || 0;
      return {
        ...t,
        _isDupe:     tiDupeUrls.has(t.url),
        _isBg:       !t.active,
        _isHib:      t.discarded,
        _isInactive: !t.active && lastActive < cutoff && lastActive > 0,
        _lastActive: lastActive,
        _group:      t.groupId > 0 ? groupMap[t.groupId] : null,
      };
    });

    // Update summary counts
    document.getElementById('ti-pinned').textContent    = tiAllTabs.filter((t) => t.pinned).length;
    document.getElementById('ti-total').textContent     = tiAllTabs.length;
    document.getElementById('ti-dupes').textContent     = tiAllTabs.filter((t) => t._isDupe).length;
    document.getElementById('ti-bg').textContent        = tiAllTabs.filter((t) => t._isBg).length;
    document.getElementById('ti-hibernated').textContent = tiAllTabs.filter((t) => t._isHib).length;

    renderTabList();
    updateBulkBar();
  } catch (e) {
    list.innerHTML = `<div class="ti-empty"><p>Could not load tabs: ${escHtml(e.message)}</p></div>`;
  }
}

function filteredTabs() {
  let tabs = tiAllTabs;
  switch (tiActiveFilter) {
    case 'duplicates': tabs = tabs.filter((t) => t._isDupe); break;
    case 'background': tabs = tabs.filter((t) => t._isBg);  break;
    case 'inactive':   tabs = tabs.filter((t) => t._isInactive); break;
    case 'hibernated': tabs = tabs.filter((t) => t._isHib); break;
  }
  if (tiSearchQuery) {
    tabs = tabs.filter((t) =>
      (t.title || '').toLowerCase().includes(tiSearchQuery) ||
      (t.url   || '').toLowerCase().includes(tiSearchQuery)
    );
  }
  return tabs;
}

function renderTabList() {
  const list = document.getElementById('ti-tab-list');
  const tabs = filteredTabs();

  if (tabs.length === 0) {
    list.innerHTML = `
      <div class="ti-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
        <p>${tiActiveFilter === 'all' ? 'No tabs open.' : 'No tabs match this filter.'}</p>
      </div>`;
    return;
  }

  // For duplicates view: group by URL then render headers
  if (tiActiveFilter === 'duplicates') {
    const byUrl = {};
    tabs.forEach((t) => { (byUrl[t.url] = byUrl[t.url] || []).push(t); });
    list.innerHTML = Object.entries(byUrl).map(([url, group]) => `
      <div class="ti-dupe-group-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        ${group.length} duplicates — ${escHtml(new URL(url).hostname)}
      </div>
      ${group.map(tabRowHtml).join('')}
    `).join('');
  } else {
    list.innerHTML = tabs.map(tabRowHtml).join('');
  }

  // Handle broken favicons without breaking layout
  list.querySelectorAll('img.ti-favicon').forEach((img) => {
    img.addEventListener('error', () => { 
      img.outerHTML = '<div class="ti-favicon-placeholder">🌐</div>'; 
    });
  });

  // ── Stale-tab guard ──────────────────────────────────────────────────────
  // Returns true if the tab still exists in the browser.
  async function safeTabExists(tabId) {
    try { await chrome.tabs.get(tabId); return true; } catch { return false; }
  }

  // Attach per-row action button listeners
  list.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { act, id } = btn.dataset;
      const tabId = parseInt(id);

      // Always verify the tab still exists before any operation
      if (!(await safeTabExists(tabId))) {
        // Tab already closed — silently refresh the list
        await loadTabInsights();
        return;
      }

      try {
        if (act === 'focus') {
          const tab = tiAllTabs.find((t) => t.id === tabId);
          if (tab) {
            if (tab.groupId !== -1) {
              try { await chrome.tabGroups.update(tab.groupId, { collapsed: false }); } catch(e){}
            }
            await chrome.windows.update(tab.windowId, { focused: true });
            await chrome.tabs.update(tabId, { active: true });
          }
        } else if (act === 'close') {
          if (await customConfirm('Close this tab?', 'Close Tab', 'Close', true)) {
            await chrome.tabs.remove(tabId);
            await loadTabInsights();
          }
        } else if (act === 'hibernate') {
          await chrome.tabs.discard(tabId);
          await loadTabInsights();
          showToast('Tab hibernated', 'success');
        } else if (act === 'restore') {
          await chrome.tabs.update(tabId, { active: true });
          await loadTabInsights();
        }
      } catch (err) {
        // If the tab vanished mid-operation, just refresh silently
        if (err.message?.includes('No tab with id')) {
          await loadTabInsights();
        } else {
          showToast('Action failed: ' + err.message, 'error');
        }
      }
    });
  });
}

function tabRowHtml(tab) {
  const favicon = tab.favIconUrl
    ? `<img class="ti-favicon" src="${escHtml(tab.favIconUrl)}" />`
    : `<div class="ti-favicon-placeholder">🌐</div>`;

  const badges = [];
  if (tab.active)       badges.push(`<span class="ti-badge active">● Active</span>`);
  if (tab._isDupe)      badges.push(`<span class="ti-badge dupe">🔁 Duplicate</span>`);
  if (tab._isHib)       badges.push(`<span class="ti-badge hib">💤 Hibernated</span>`);
  if (tab._isInactive)  badges.push(`<span class="ti-badge inactive">🕐 Inactive</span>`);
  else if (tab._isBg)   badges.push(`<span class="ti-badge bg">○ Background</span>`);
  if (tab._group)       badges.push(`<span class="ti-badge group">🗂 ${escHtml(tab._group.title || 'Group')}</span>`);

  const timeAgo = tab._lastActive ? formatTimeAgo(tab._lastActive) : '';

  const rowClass = [
    'ti-tab-row',
    tab._isDupe ? 'is-dupe' : '',
    tab._isHib  ? 'is-hib'  : '',
    tab._isInactive && !tab._isDupe && !tab._isHib ? 'is-inactive' : '',
  ].filter(Boolean).join(' ');

  return `
  <div class="${rowClass}">
    ${favicon}
    <div class="ti-tab-info">
      <div class="ti-tab-title">${escHtml(tab.title || 'Untitled')}</div>
      <div class="ti-tab-url">${escHtml(tab.url || '')}</div>
    </div>
    <div class="ti-badges">${badges.join('')}</div>
    <div class="ti-tab-time">${escHtml(timeAgo)}</div>
    <div class="ti-tab-actions">
      <button class="ti-act-btn" data-act="focus" data-id="${tab.id}" title="Switch to tab">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </button>
      ${tab._isHib
        ? `<button class="ti-act-btn" data-act="restore" data-id="${tab.id}" title="Wake tab">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-3.9L1 10"/></svg>
           </button>`
        : `<button class="ti-act-btn" data-act="hibernate" data-id="${tab.id}" title="Hibernate tab">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
           </button>`
      }
      <button class="ti-act-btn danger" data-act="close" data-id="${tab.id}" title="Close tab">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </div>`;
}

function updateBulkBar() {
  const bar     = document.getElementById('ti-bulk-bar');
  const label   = document.getElementById('ti-bulk-label');
  const actions = document.getElementById('ti-bulk-actions');
  const tabs    = filteredTabs();

  if (tiActiveFilter === 'all' || tabs.length === 0) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';

  const labels = {
    duplicates: `${tabs.length} duplicate tab${tabs.length !== 1 ? 's' : ''} found`,
    background: `${tabs.length} background tab${tabs.length !== 1 ? 's' : ''}`,
    inactive:   `${tabs.length} inactive tab${tabs.length !== 1 ? 's' : ''} (not visited in ${INACTIVE_DAYS}+ days)`,
    hibernated: `${tabs.length} hibernated tab${tabs.length !== 1 ? 's' : ''}`,
  };
  label.textContent = labels[tiActiveFilter] || '';

  const bulkBtns = {
    duplicates: `<button class="btn btn-secondary" id="ti-bulk-close-dupes">Close All Duplicates</button>`,
    background: `<button class="btn btn-secondary" id="ti-bulk-hibernate-bg">Hibernate All</button>`,
    inactive:   `<button class="btn btn-danger-outline" id="ti-bulk-close-inactive">Close All Inactive</button>`,
    hibernated: `<button class="btn btn-secondary" id="ti-bulk-restore-all">Restore All</button>`,
  };
  actions.innerHTML = bulkBtns[tiActiveFilter] || '';

  // Bulk action handlers
  document.getElementById('ti-bulk-close-dupes')?.addEventListener('click', async () => {
    if (!(await customConfirm(`Close ${tabs.length} duplicate tabs?`, 'Close Tabs', 'Close', true))) return;
    const seen = new Set();
    const toClose = [];
    for (const t of tiAllTabs) {
      if (tiDupeUrls.has(t.url)) {
        if (seen.has(t.url)) toClose.push(t.id);
        else seen.add(t.url);
      }
    }
    // Filter out any tabs that have already been closed
    const stillOpen = (await Promise.all(
      toClose.map(async (id) => {
        try { await chrome.tabs.get(id); return id; } catch { return null; }
      })
    )).filter(Boolean);
    if (stillOpen.length) await chrome.tabs.remove(stillOpen);
    await loadTabInsights();
    showToast(`✅ Closed ${stillOpen.length} duplicate tabs`, 'success');
  });

  document.getElementById('ti-bulk-hibernate-bg')?.addEventListener('click', async () => {
    if (!(await customConfirm(`Hibernate ${tabs.length} background tabs?`, 'Hibernate Tabs', 'Hibernate'))) return;
    for (const t of tabs) {
      try { await chrome.tabs.discard(t.id); } catch { /* skip active/pinned */ }
    }
    await loadTabInsights();
    showToast(`✅ Hibernated background tabs`, 'success');
  });

  document.getElementById('ti-bulk-close-inactive')?.addEventListener('click', async () => {
    if (!(await customConfirm(`Close ${tabs.length} inactive tabs? This cannot be undone.`, 'Close Tabs', 'Close', true))) return;
    // Filter out any tabs that closed since the list was rendered
    const ids = tabs.map((t) => t.id);
    const stillOpen = (await Promise.all(
      ids.map(async (id) => {
        try { await chrome.tabs.get(id); return id; } catch { return null; }
      })
    )).filter(Boolean);
    if (stillOpen.length) await chrome.tabs.remove(stillOpen);
    await loadTabInsights();
    showToast(`✅ Closed ${stillOpen.length} inactive tabs`, 'success');
  });

  document.getElementById('ti-bulk-restore-all')?.addEventListener('click', async () => {
    for (const t of tabs) {
      try { await chrome.tabs.update(t.id, { active: true }); } catch { /* skip */ }
    }
    await loadTabInsights();
    showToast(`✅ Restored ${tabs.length} tabs`, 'success');
  });
}

function formatTimeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60)  return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)  return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

// ─── Category Grouping ────────────────────────────────────────────────────────

const CAT_COLOR_HEX = {
  blue:'#4285f4', green:'#34a853', red:'#ea4335', yellow:'#fbbc04',
  pink:'#ff6d94', purple:'#a142f4', cyan:'#24c1e0', orange:'#ff8c00', grey:'#8b949e',
};
const CAT_COLORS = Object.keys(CAT_COLOR_HEX);
const EMOJI_OPTIONS = ['📁','💼','🛒','💸','📚','🎮','🛠️','🎨','🔒','⚙️','🚀','💡','📫','🗓️','💬','🌐'];

// In-memory state for category overrides (mutated by card interactions)
let catOverrideState = {}; // { [catId]: { enabled: bool, color: string } }

let localCategoryOrder = [];
let customCatState = []; // [{ id, name, emoji, color, patterns[] }]

function initUnifiedCategories() {
  catOverrideState = JSON.parse(JSON.stringify(currentSettings.categoryOverrides || {}));
  customCatState = JSON.parse(JSON.stringify(currentSettings.customCategories || []));
  localCategoryOrder = [...(currentSettings.categoryOrder || [])];

  renderUnifiedCategoryList();

  document.getElementById('btn-add-custom-cat')?.addEventListener('click', () => {
    openCustomCatEditor(null);
  });

  document.getElementById('btn-reset-cat-order')?.addEventListener('click', async () => {
    if (await customConfirm('Reset category order to default?', 'Reset Order', 'Reset', true)) {
      localCategoryOrder = [];
      renderUnifiedCategoryList();
      autoSave();
    }
  });
}

function renderUnifiedCategoryList() {
  const grid = document.getElementById('category-cards-grid');
  if (!grid) return;

  const builtInMap = Object.fromEntries(BUILTIN_CATEGORIES.map(c => [c.id, c]));
  const customMap = Object.fromEntries(customCatState.map((c, i) => [c.id, { ...c, _idx: i }]));

  const evaluateOrder = [...localCategoryOrder];
  const allIds = new Set([...Object.keys(builtInMap), ...Object.keys(customMap)]);
  for (const id of allIds) {
    if (!evaluateOrder.includes(id)) evaluateOrder.push(id);
  }

  grid.innerHTML = evaluateOrder.map((catId) => {
    const isCustom = customMap.hasOwnProperty(catId);
    const isBuiltIn = builtInMap.hasOwnProperty(catId);
    if (!isCustom && !isBuiltIn) return '';

    let innerHTML = '';

    if (isCustom) {
      const cat = customMap[catId];
      const patCount = (cat.patterns || []).length;
      innerHTML = `
      <div class="cc-card ${cat.enabled !== false ? '' : 'disabled'}" data-idx="${cat._idx}" data-color="${cat.color || 'blue'}">
        <div class="cc-card-left">
          <div class="drag-handle" title="Drag to reorder" style="padding:0; margin-right:4px"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></div>
          <span class="cc-emoji">${escHtml(cat.emoji || '📁')}</span>
          <div class="cc-card-info">
            <div class="cc-card-name">${escHtml(cat.name || 'Unnamed')}</div>
            <div class="cc-card-meta">${patCount} pattern${patCount !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div class="cc-card-right">
          <label class="toggle cat-toggle" style="margin-right:8px" title="${cat.enabled !== false ? 'Disable category' : 'Enable category'}">
            <input type="checkbox" class="custom-cat-enabled-cb" data-idx="${cat._idx}" ${cat.enabled !== false ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
          <button class="btn btn-sm btn-secondary cc-edit-btn" data-idx="${cat._idx}">Edit</button>
          <button class="btn btn-sm btn-danger-outline cc-del-btn" data-idx="${cat._idx}" title="Delete category">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </div>
      </div>`;
    } else {
      const cat = builtInMap[catId];
      const ov           = catOverrideState[cat.id] || {};
      const enabled      = ov.enabled !== false;
      const color        = ov.color || cat.color;
      const extraPats    = ov.extraPatterns || [];
      const patCount     = cat.patterns.length + extraPats.length;
  
      innerHTML = `
      <div class="cc-card ${enabled ? '' : 'disabled'}" data-color="${color}">
        <div class="cc-card-left">
          <div class="drag-handle" title="Drag to reorder" style="padding:0; margin-right:4px"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></div>
          <span class="cc-emoji">${escHtml(cat.emoji)}</span>
          <div class="cc-card-info">
            <div class="cc-card-name">${escHtml(cat.name)}</div>
            <div class="cc-card-meta">${patCount} pattern${patCount !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div class="cc-card-right">
          <label class="toggle cat-toggle" style="margin-right:8px" title="${enabled ? 'Disable category' : 'Enable category'}">
            <input type="checkbox" class="cat-enabled-cb" data-cat="${cat.id}" ${enabled ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
          <button class="btn btn-sm btn-secondary builtin-edit-btn" data-cat="${cat.id}">Edit</button>
        </div>
      </div>`;
    }

    return `
      <div class="unified-cat-item" draggable="true" data-catid="${catId}" style="width:100%">
        <div class="unified-cat-content" style="flex:1; min-width:0;">${innerHTML}</div>
      </div>
    `;
  }).join('');

  wireUnifiedInteractions(grid);
  wireDragAndDrop(grid);
}

function wireDragAndDrop(grid) {
  let draggedItem = null;
  
  grid.querySelectorAll('.unified-cat-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedItem = item;
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });
    
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      draggedItem = null;
      
      const newOrder = Array.from(grid.querySelectorAll('.unified-cat-item')).map(el => el.dataset.catid);
      localCategoryOrder = newOrder;
      autoSave();
    });
  });
  
  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const afterElement = getDragAfterElement(grid, e.clientY);
    const currentElement = draggedItem;
    if (currentElement) {
      if (afterElement == null) {
        grid.appendChild(currentElement);
      } else {
        grid.insertBefore(currentElement, afterElement);
      }
    }
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.unified-cat-item:not(.dragging)')];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function wireUnifiedInteractions(grid) {
  grid.querySelectorAll('.cc-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => openCustomCatEditor(parseInt(btn.dataset.idx)));
  });

  grid.querySelectorAll('.cc-del-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const catId = customCatState[idx].id;
      customCatState.splice(idx, 1);
      localCategoryOrder = localCategoryOrder.filter(id => id !== catId);
      renderUnifiedCategoryList();
      autoSave();
    });
  });

  grid.querySelectorAll('.cat-enabled-cb').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.cat;
      catOverrideState[id] = { ...(catOverrideState[id] || {}), enabled: cb.checked };
      grid.querySelector(`.cc-card[data-catid="${id}"]`)?.classList.toggle('disabled', !cb.checked);
      autoSave();
    });
  });

  grid.querySelectorAll('.custom-cat-enabled-cb').forEach((cb) => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.dataset.idx);
      customCatState[idx].enabled = cb.checked;
      renderUnifiedCategoryList();
      autoSave();
    });
  });

  grid.querySelectorAll('.builtin-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => openBuiltInCatEditor(btn.dataset.cat));
  });
}

function collectCategoryOverrides() {
  return JSON.parse(JSON.stringify(catOverrideState));
}

function renderModalPatList(overlay, pats) {
  const list = overlay.querySelector('#cc-pat-list');
  if (!list) return;
  if (pats.length === 0) {
    list.innerHTML = '<div class="pat-empty" style="padding:6px 0">No patterns yet — add one below.</div>';
    return;
  }
  list.innerHTML = pats.map((p, i) => {
    const type  = typeof p === 'string' ? 'url-contains' : p.type;
    const value = typeof p === 'string' ? p : p.value;
    return `
      <div class="cc-pat-row">
        <span class="pat-type-badge">${escHtml(type)}</span>
        <span class="cc-pat-val">${escHtml(value)}</span>
        <button class="pat-chip-remove cc-pat-del" data-idx="${i}" title="Remove">\u00d7</button>
      </div>`;
  }).join('');
}

function openCustomCatEditor(idx) {
  const isNew = idx === null;
  const cat   = isNew
    ? { id: `custom-${Date.now()}`, name: '', emoji: '📁', color: 'blue', patterns: [] }
    : JSON.parse(JSON.stringify(customCatState[idx]));

  const overlay = document.createElement('div');
  overlay.className = 'cc-overlay';
  overlay.innerHTML = `
    <div class="cc-modal">
      <div class="cc-modal-header">
        <span>${isNew ? 'New Category' : 'Edit Category'}</span>
        <button class="icon-btn-sm cc-close-modal" title="Close">✕</button>
      </div>

      <div class="cc-modal-body">
        <!-- Name + Emoji row -->
        <div class="cc-field-row">
          <div class="cc-field" style="flex:0 0 auto">
            <label class="field-label">Emoji</label>
            <div class="cc-emoji-picker" id="cc-emoji-val" title="Click to pick">${escHtml(cat.emoji)}</div>
          </div>
          <div class="cc-field" style="flex:1">
            <label class="field-label">Category Name</label>
            <input class="input" id="cc-name" placeholder="e.g. Legal, HR, Research…" maxlength="32" value="${escHtml(cat.name)}" />
          </div>
        </div>

        <!-- Emoji picker grid -->
        <div class="cc-emoji-grid" id="cc-emoji-grid" style="display:none">
          ${EMOJI_OPTIONS.map((e) => `<button class="cc-emoji-opt${e === cat.emoji ? ' active' : ''}" data-emoji="${e}">${e}</button>`).join('')}
        </div>

        <!-- Color -->
        <div class="cc-field">
          <label class="field-label">Group Color</label>
          <div class="cat-color-row">
            ${CAT_COLORS.map((c) => `
              <button class="cat-color-dot cc-color-dot ${c === cat.color ? 'active' : ''}"
                data-color="${c}" style="background:${CAT_COLOR_HEX[c]}" title="${c}"></button>
            `).join('')}
          </div>
        </div>

        <!-- Patterns -->
        <div class="cc-field">
          <label class="field-label">Patterns <span class="field-hint">— a tab matching ANY pattern will be grouped</span></label>
          <div class="cc-pat-list" id="cc-pat-list"></div>
          <div class="pat-add-row" style="margin-top:8px">
            <select class="pat-type-sel input" id="cc-pat-type">
              <option value="url-contains">URL contains</option>
              <option value="hostname-contains">Host contains</option>
              <option value="hostname-exact">Host exact</option>
              <option value="base-domain">Base domain</option>
              <option value="regex">Regex</option>
            </select>
            <input class="pat-add-input input" id="cc-pat-input" placeholder="e.g. mycompany.com" type="text" />
            <button class="btn btn-sm btn-secondary" id="cc-pat-add-btn">+ Add</button>
          </div>
          <div class="tag-hint">Each pattern is independent. A tab matching ANY pattern is grouped.</div>
        </div>
      </div>

      <div class="cc-modal-footer">
        <button class="btn btn-ghost cc-close-modal">Cancel</button>
        <button class="btn btn-primary" id="cc-save-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          ${isNew ? 'Create Category' : 'Save Changes'}
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Seed modal patterns from cat.patterns
  const modalPatterns = JSON.parse(JSON.stringify(cat.patterns || []));
  renderModalPatList(overlay, modalPatterns);

  // Wire pattern add button
  const ccPatInput  = overlay.querySelector('#cc-pat-input');
  const ccPatTypeEl = overlay.querySelector('#cc-pat-type');
  const ccPatAddBtn = overlay.querySelector('#cc-pat-add-btn');

  const doAddPat = () => {
    const val  = ccPatInput?.value?.trim();
    if (!val) return;
    const type = ccPatTypeEl?.value || 'url-contains';
    modalPatterns.push({ type, value: val.toLowerCase() });
    ccPatInput.value = '';
    renderModalPatList(overlay, modalPatterns);
  };

  ccPatAddBtn?.addEventListener('click', doAddPat);
  ccPatInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAddPat(); } });

  // Wire remove buttons via event delegation on overlay
  overlay.querySelector('#cc-pat-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.cc-pat-del');
    if (!btn) return;
    modalPatterns.splice(parseInt(btn.dataset.idx), 1);
    renderModalPatList(overlay, modalPatterns);
  });

  let selColor = cat.color || 'blue';
  let selEmoji = cat.emoji || '📁';

  // Emoji picker toggle
  const emojiVal  = overlay.querySelector('#cc-emoji-val');
  const emojiGrid = overlay.querySelector('#cc-emoji-grid');
  emojiVal.addEventListener('click', () => {
    emojiGrid.style.display = emojiGrid.style.display === 'none' ? '' : 'none';
  });
  overlay.querySelectorAll('.cc-emoji-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      selEmoji = btn.dataset.emoji;
      emojiVal.textContent = selEmoji;
      overlay.querySelectorAll('.cc-emoji-opt').forEach((b) => b.classList.toggle('active', b === btn));
      emojiGrid.style.display = 'none';
    });
  });

  // Color dots
  overlay.querySelectorAll('.cc-color-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      selColor = dot.dataset.color;
      overlay.querySelectorAll('.cc-color-dot').forEach((d) => d.classList.toggle('active', d === dot));
    });
  });

  // Close buttons
  overlay.querySelectorAll('.cc-close-modal').forEach((btn) => {
    btn.addEventListener('click', () => overlay.remove());
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // Save
  overlay.querySelector('#cc-save-btn').addEventListener('click', () => {
    const name = overlay.querySelector('#cc-name').value.trim();
    if (!name) { overlay.querySelector('#cc-name').focus(); return; }

    const patterns = modalPatterns.filter((p) => (typeof p === 'string' ? p : p.value));
    if (patterns.length === 0) { overlay.querySelector('#cc-pat-input')?.focus(); return; }

    const updated = { id: cat.id, name, emoji: selEmoji, color: selColor, patterns };

    if (isNew) {
      customCatState.push(updated);
      localCategoryOrder.push(updated.id);
    } else {
      customCatState[idx] = updated;
    }

    overlay.remove();
    renderUnifiedCategoryList();
    autoSave();
    showToast(isNew ? 'Category created' : 'Category saved', 'success');
  });
}

function openBuiltInCatEditor(catId) {
  const cat = BUILTIN_CATEGORIES.find((c) => c.id === catId);
  if (!cat) return;
  const ov = catOverrideState[catId] || {};
  let selColor = ov.color || cat.color;

  const overlay = document.createElement('div');
  overlay.className = 'cc-overlay';
  
  const builtinChips = cat.patterns.map((p) =>
    `<span class="pat-chip pat-chip-builtin" title="Built-in pattern">${escHtml(p)}</span>`
  ).join('');

  overlay.innerHTML = `
    <div class="cc-modal">
      <div class="cc-modal-header">
        <span>Settings &amp; Rules</span>
        <button class="icon-btn-sm cc-close-modal" title="Close">✕</button>
      </div>

      <div class="cc-modal-body">
        <div style="display:flex; align-items:center; gap:12px; margin-bottom: 12px">
          <span style="font-size:24px">${cat.emoji}</span>
          <div>
            <div style="font-weight:600; font-size:14px">${escHtml(cat.name)}</div>
            <div class="cat-desc" style="margin-bottom:0">${escHtml(cat.desc)}</div>
          </div>
        </div>

        <!-- Color -->
        <div class="cc-field">
          <label class="field-label">Group Color</label>
          <div class="cat-color-row">
            ${CAT_COLORS.map((c) => `
              <button class="cat-color-dot cc-color-dot ${c === selColor ? 'active' : ''}"
                data-color="${c}" style="background:${CAT_COLOR_HEX[c]}" title="${c}"></button>
            `).join('')}
          </div>
        </div>

        <!-- Patterns -->
        <div class="cc-field">
          <label class="field-label">Built-in Patterns <span class="pat-hint">(read-only)</span></label>
          <div class="pat-chips-row">${builtinChips}</div>
        </div>

        <div class="cc-field">
          <label class="field-label">Custom Patterns <span class="field-hint">— a tab matching ANY pattern will be grouped</span></label>
          <div class="cc-pat-list" id="cc-pat-list"></div>
          <div class="pat-add-row" style="margin-top:8px">
            <select class="pat-type-sel input" id="cc-pat-type">
              <option value="url-contains">URL contains</option>
              <option value="hostname-contains">Host contains</option>
              <option value="hostname-exact">Host exact</option>
              <option value="base-domain">Base domain</option>
              <option value="regex">Regex</option>
            </select>
            <input class="pat-add-input input" id="cc-pat-input" placeholder="e.g. mycompany.com" type="text" />
            <button class="btn btn-sm btn-secondary" id="cc-pat-add-btn">+ Add</button>
          </div>
        </div>
      </div>

      <div class="cc-modal-footer">
        <button class="btn btn-ghost cc-close-modal">Cancel</button>
        <button class="btn btn-primary" id="cc-save-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          Save Changes
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Seed modal patterns from extraPatterns
  const modalPatterns = JSON.parse(JSON.stringify(ov.extraPatterns || []));
  renderModalPatList(overlay, modalPatterns);

  // Wire pattern add button
  const ccPatInput  = overlay.querySelector('#cc-pat-input');
  const ccPatTypeEl = overlay.querySelector('#cc-pat-type');
  const ccPatAddBtn = overlay.querySelector('#cc-pat-add-btn');

  const doAddPat = () => {
    const val  = ccPatInput?.value?.trim();
    if (!val) return;
    const type = ccPatTypeEl?.value || 'url-contains';
    modalPatterns.push({ type, value: val.toLowerCase() });
    ccPatInput.value = '';
    renderModalPatList(overlay, modalPatterns);
  };

  ccPatAddBtn?.addEventListener('click', doAddPat);
  ccPatInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAddPat(); } });

  // Wire remove buttons via event delegation on overlay
  overlay.querySelector('#cc-pat-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.cc-pat-del');
    if (!btn) return;
    modalPatterns.splice(parseInt(btn.dataset.idx), 1);
    renderModalPatList(overlay, modalPatterns);
  });

  // Color dots
  overlay.querySelectorAll('.cc-color-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      selColor = dot.dataset.color;
      overlay.querySelectorAll('.cc-color-dot').forEach((d) => d.classList.toggle('active', d === dot));
    });
  });

  // Close buttons
  overlay.querySelectorAll('.cc-close-modal').forEach((btn) => {
    btn.addEventListener('click', () => overlay.remove());
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // Save
  overlay.querySelector('#cc-save-btn').addEventListener('click', () => {
    const extraPatterns = modalPatterns.filter((p) => (typeof p === 'string' ? p : p.value));
    
    catOverrideState[catId] = {
      ...(catOverrideState[catId] || {}),
      color: selColor,
      extraPatterns
    };

    overlay.remove();
    renderUnifiedCategoryList();
    autoSave();
    showToast('Category saved', 'success');
  });
}

function collectCustomCategories() {
  return JSON.parse(JSON.stringify(customCatState));
}

// ─── Grouping Section Wiring ──────────────────────────────────────────────────
// Handles: Group by Domain → shows/hides subdomain row
//          Group by Subdomain → shows/hides "Always split" pattern panel
//          Subdomain domain typed patterns (sd-pat-*) + regex validator

let sdDomPatterns = []; // string array
let excDomPatterns = []; // string array

function syncSubdomainChildVisibility() {
  const subdomainEl   = document.getElementById('setting-subdomainGrouping');
  const exceptionsWrap = document.getElementById('grouping-exceptions-wrap');

  if (exceptionsWrap) {
    exceptionsWrap.style.display = subdomainEl?.checked ? '' : 'none';
  }
}

function renderTagList(containerId, listArray, renderCallback) {
  const listEl = document.getElementById(containerId);
  if (!listEl) return;
  if (listArray.length === 0) {
    listEl.innerHTML = '';
    return;
  }
  listEl.innerHTML = listArray.map((val, i) => `
    <span class="tag-chip">
      ${escHtml(val)}
      <button class="tag-chip-remove" data-idx="${i}" title="Remove">×</button>
    </span>
  `).join('');

  listEl.querySelectorAll('.tag-chip-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      listArray.splice(parseInt(btn.dataset.idx), 1);
      renderCallback();
      markDirty();
    });
  });
}

function renderSdTagList() {
  // Normalize legacy { type, value } format to strings
  sdDomPatterns = sdDomPatterns.map(p => typeof p === 'string' ? p : (p.value || '')).filter(Boolean);
  renderTagList('sd-tag-list', sdDomPatterns, renderSdTagList);
}

function renderExcTagList() {
  renderTagList('exc-tag-list', excDomPatterns, renderExcTagList);
}

function setupTagInput(inputId, listArray, renderCallback) {
  const inputEl = document.getElementById(inputId);
  if (!inputEl) return;
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = inputEl.value.trim().toLowerCase();
      if (!val) return;
      if (!listArray.includes(val)) {
        listArray.push(val);
        renderCallback();
        markDirty();
      }
      inputEl.value = '';
    }
  });
}

function initGroupingWiring() {
  // ── Group by Domain parent toggle → show/hide subdomain row ──────────────
  document.getElementById('setting-groupByDomain')?.addEventListener('change', () => {
    // Parent group by domain is handled natively by CSS grouping.
    markDirty();
  });

  // ── Group by Subdomain toggle → show/hide "Always split" panel ───────────
  document.getElementById('setting-subdomainGrouping')?.addEventListener('change', () => {
    syncSubdomainChildVisibility();
    markDirty();
  });

  setupTagInput('sd-tag-input', sdDomPatterns, renderSdTagList);
  setupTagInput('exc-tag-input', excDomPatterns, renderExcTagList);
}

// ─── Dashboard ────────────────────────────────────────────────
async function initDashboard() {
  const stats = await getStats();
  document.getElementById('dash-val-grouped').textContent = (stats.tabsAutoGrouped || 0).toLocaleString();
  document.getElementById('dash-val-cleaned').textContent = (stats.tabsCleanedUp || 0).toLocaleString();

  const tabs = await chrome.tabs.query({});

  // Category breakdown
  const overrides = currentSettings.categoryOverrides || {};
  const catTabsMap = {}; // { catId: [tab, ...] }
  const uncategorizedTabs = [];

  for (const tab of tabs) {
    if (tab.pinned) {
      if (!catTabsMap['pinned']) catTabsMap['pinned'] = [];
      catTabsMap['pinned'].push(tab);
      continue;
    }

    let matched = false;

    const builtInMap = Object.fromEntries(BUILTIN_CATEGORIES.map(c => [c.id, c]));
    const customMap = Object.fromEntries((currentSettings.customCategories || []).map(c => [c.id, c]));
    const order = currentSettings.categoryOrder || [];

    const evaluateOrder = [...order];
    const allCatIds = new Set([...Object.keys(builtInMap), ...Object.keys(customMap)]);
    for (const id of allCatIds) {
      if (!evaluateOrder.includes(id)) evaluateOrder.push(id);
    }

    for (const catId of evaluateOrder) {
      const isCustom = customMap.hasOwnProperty(catId);
      const isBuiltIn = builtInMap.hasOwnProperty(catId);
      if (!isCustom && !isBuiltIn) continue;

      let effectiveCat;
      if (isCustom) {
        const cat = customMap[catId];
        if (cat.enabled === false) continue;
        if (!cat.patterns?.length) continue;
        effectiveCat = cat;
      } else {
        const cat = builtInMap[catId];
        const ov = overrides[cat.id] || {};
        if (ov.enabled === false) continue;
        effectiveCat = { ...cat, patterns: [...cat.patterns, ...(ov.extraPatterns || [])] };
      }

      if (tabMatchesCategory(tab, effectiveCat)) {
        if (!catTabsMap[catId]) catTabsMap[catId] = [];
        catTabsMap[catId].push(tab);
        matched = true;
        break;
      }
    }

    if (!matched) uncategorizedTabs.push(tab);
  }

  // Build sorted array
  const breakdown = [];
  
  if (catTabsMap['pinned']) {
    breakdown.push({ id: 'pinned', name: '📌 Pinned Tabs', color: 'orange', tabs: catTabsMap['pinned'] });
  }

  const builtInMap = Object.fromEntries(BUILTIN_CATEGORIES.map(c => [c.id, c]));
  const customMap = Object.fromEntries((currentSettings.customCategories || []).map(c => [c.id, c]));
  const order = currentSettings.categoryOrder || [];
  const evaluateOrder = [...order];
  const allCatIds = new Set([...Object.keys(builtInMap), ...Object.keys(customMap)]);
  for (const id of allCatIds) {
    if (!evaluateOrder.includes(id)) evaluateOrder.push(id);
  }

  for (const catId of evaluateOrder) {
    if (!catTabsMap[catId]) continue;
    
    if (customMap.hasOwnProperty(catId)) {
      const cat = customMap[catId];
      const name = cat.name || 'Custom';
      const emoji = cat.emoji || '📁';
      breakdown.push({ id: catId, name: `${emoji} ${name}`, color: cat.color || 'blue', tabs: catTabsMap[catId] });
    } else if (builtInMap.hasOwnProperty(catId)) {
      const cat = builtInMap[catId];
      const name = overrides[cat.id]?.name || cat.name;
      const color = overrides[cat.id]?.color || cat.color;
      breakdown.push({ id: catId, name: `${cat.emoji} ${name}`, color, tabs: catTabsMap[catId] });
    }
  }

  if (uncategorizedTabs.length > 0) {
    breakdown.push({ id: 'uncategorized', name: '🌐 Other / Uncategorized', color: 'grey', tabs: uncategorizedTabs });
  }

  // Find max count for bar chart rendering
  let maxCount = 0;
  for (const group of breakdown) {
    if (group.tabs.length > maxCount) maxCount = group.tabs.length;
  }

  const chartContainer = document.getElementById('dash-cat-breakdown');
  const listContainer = document.getElementById('dash-cat-list');
  
  if (breakdown.length === 0) {
    chartContainer.innerHTML = `<div class="ti-empty">No open tabs found.</div>`;
    listContainer.innerHTML = `<div class="ti-empty">No open tabs found.</div>`;
    return;
  }
  
  // Reuse CAT_COLOR_HEX mapping from categories code
  const colorHexMap = {
    grey: '#8b949e', blue: '#4285f4', red: '#ea4335', yellow: '#fbbc04',
    green: '#34a853', pink: '#ff69b4', purple: '#a142f4', cyan: '#24c1e0', orange: '#ff9900'
  };

  // Render Bar Chart
  chartContainer.innerHTML = breakdown.map(b => {
    const width = Math.max(5, Math.round((b.tabs.length / maxCount) * 100));
    const hex = colorHexMap[b.color] || colorHexMap.grey;
    return `
      <div class="dash-cat-row">
        <div class="dash-cat-name" title="${escHtml(b.name)}">${escHtml(b.name)}</div>
        <div class="dash-cat-bar-container">
          <div class="dash-cat-bar" style="width: ${width}%; background: ${hex}"></div>
        </div>
        <div class="dash-cat-count">${b.tabs.length}</div>
      </div>
    `;
  }).join('');

  // Render Accordion List
  listContainer.innerHTML = breakdown.map(b => {
    const tabRows = b.tabs.map(t => {
      const favicon = t.favIconUrl
        ? `<img class="dash-acc-icon" src="${escHtml(t.favIconUrl)}" />`
        : `<div class="dash-acc-icon-placeholder">🌐</div>`;
      return `
      <div class="dash-acc-tab">
        <div class="dash-acc-icon-wrap">${favicon}</div>
        <div class="dash-acc-info">
          <div class="dash-acc-name" title="${escHtml(t.title)}">${escHtml(t.title || 'Unknown Page')}</div>
          <div class="dash-acc-url" title="${escHtml(t.url)}">${escHtml(t.url)}</div>
        </div>
      </div>
      `;
    }).join('');

    return `
      <div class="dash-acc-group" id="dash-acc-${b.id}">
        <div class="dash-acc-header">
          <div class="dash-acc-title">
            <span>${escHtml(b.name)}</span>
            <span class="ti-badge group" style="color: ${colorHexMap[b.color] || '#8b949e'}; border-color: ${colorHexMap[b.color] || '#8b949e'}40; background: ${colorHexMap[b.color] || '#8b949e'}15;">${b.tabs.length}</span>
          </div>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--text-muted)" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
        <div class="dash-acc-body">
          ${tabRows}
        </div>
      </div>
    `;
  }).join('');

  // Handle broken favicons
  listContainer.querySelectorAll('img.dash-acc-icon').forEach((img) => {
    img.addEventListener('error', () => { 
      img.outerHTML = '<div class="dash-acc-icon-placeholder">🌐</div>'; 
    });
  });

  // Wire Accordion toggle
  listContainer.querySelectorAll('.dash-acc-header').forEach(header => {
    header.addEventListener('click', () => {
      const group = header.parentElement;
      group.classList.toggle('open');
    });
  });
}

// ─── Dashboard View Toggle ────────────────────────────────────
function initDashboardToggle() {
  document.querySelectorAll('.dash-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dash-view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      if (view === 'chart') {
        document.getElementById('dash-cat-breakdown').style.display = 'flex';
        document.getElementById('dash-cat-list').style.display = 'none';
      } else {
        document.getElementById('dash-cat-breakdown').style.display = 'none';
        document.getElementById('dash-cat-list').style.display = 'flex';
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initDashboardToggle();
});

// ─── Reset Settings Modal ──────────────────────────────────────────
function openResetSettingsModal() {
  const overlay = document.createElement('div');
  overlay.className = 'cc-overlay';

  overlay.innerHTML = `
    <div class="cc-modal" style="width:400px">
      <div class="cc-modal-header">
        <h2 class="cc-modal-title">Reset Settings</h2>
      </div>
      <div class="cc-modal-body">
        <div class="setting-desc" style="margin-bottom:16px">
          Select which settings you want to reset to their default values. Your saved sessions will not be deleted.
        </div>
        
        <label style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; cursor:pointer;">
          <span style="font-size:14px; color:var(--text-primary)">General Settings (UI, Limits)</span>
          <div class="toggle cat-toggle" style="transform: scale(0.85); transform-origin: right center;">
            <input type="checkbox" id="reset-general" checked />
            <span class="toggle-slider"></span>
          </div>
        </label>
        
        <label style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; cursor:pointer;">
          <span style="font-size:14px; color:var(--text-primary)">Category Rules & Order</span>
          <div class="toggle cat-toggle" style="transform: scale(0.85); transform-origin: right center;">
            <input type="checkbox" id="reset-categories" checked />
            <span class="toggle-slider"></span>
          </div>
        </label>
        
        <label style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; cursor:pointer;">
          <span style="font-size:14px; color:var(--text-primary)">Domain Exceptions</span>
          <div class="toggle cat-toggle" style="transform: scale(0.85); transform-origin: right center;">
            <input type="checkbox" id="reset-domains" checked />
            <span class="toggle-slider"></span>
          </div>
        </label>
      </div>
      <div class="cc-modal-footer">
        <button class="btn btn-ghost" id="reset-cancel">Cancel</button>
        <button class="btn btn-danger-solid" id="reset-confirm">Reset Selected</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#reset-cancel').addEventListener('click', close);
  
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const cbGen = overlay.querySelector('#reset-general');
  const cbCat = overlay.querySelector('#reset-categories');
  const cbDom = overlay.querySelector('#reset-domains');
  const confirmBtn = overlay.querySelector('#reset-confirm');

  const updateBtnState = () => {
    if (!cbGen.checked && !cbCat.checked && !cbDom.checked) {
      confirmBtn.disabled = true;
      confirmBtn.style.opacity = '0.5';
      confirmBtn.style.cursor = 'not-allowed';
    } else {
      confirmBtn.disabled = false;
      confirmBtn.style.opacity = '1';
      confirmBtn.style.cursor = 'pointer';
    }
  };

  cbGen.addEventListener('change', updateBtnState);
  cbCat.addEventListener('change', updateBtnState);
  cbDom.addEventListener('change', updateBtnState);

  confirmBtn.addEventListener('click', async () => {
    const doGen = cbGen.checked;
    const doCat = cbCat.checked;
    const doDom = cbDom.checked;
    
    if (!doGen && !doCat && !doDom) {
      close();
      return;
    }

    const defaults = await getSettings(); // get pure default settings

    if (doGen) {
      currentSettings.theme = defaults.theme;
      currentSettings.showTabCount = defaults.showTabCount;
      currentSettings.confirmBeforeCleanup = defaults.confirmBeforeCleanup;
      currentSettings.autoGroup = defaults.autoGroup;
      currentSettings.autoGroupOnStartup = defaults.autoGroupOnStartup;
      currentSettings.groupByDomain = defaults.groupByDomain;
      currentSettings.subdomainGrouping = defaults.subdomainGrouping;
      currentSettings.groupSingleTabs = defaults.groupSingleTabs;
      currentSettings.sortTabsAndGroups = defaults.sortTabsAndGroups;
      currentSettings.sortGroupsAlphabetically = defaults.sortGroupsAlphabetically;
      currentSettings.groupCollapseAfterSwitch = defaults.groupCollapseAfterSwitch;
      currentSettings.autoSaveSession = defaults.autoSaveSession;
      currentSettings.notificationsEnabled = defaults.notificationsEnabled;
      currentSettings.tabLimitWarning = defaults.tabLimitWarning;
      currentSettings.inactiveDays = defaults.inactiveDays;
    }

    if (doCat) {
      currentSettings.categoryOverrides = defaults.categoryOverrides;
      currentSettings.customCategories = defaults.customCategories;
      currentSettings.categoryOrder = defaults.categoryOrder;
    }

    if (doDom) {
      currentSettings.subdomainDomains = defaults.subdomainDomains;
      currentSettings.excludedDomains = defaults.excludedDomains;
    }

    await chrome.storage.local.set({ settings: currentSettings });
    populateSettings(currentSettings); // Refreshes the UI arrays
    if (doCat) initUnifiedCategories(); // Re-render category grid from updated state
    
    isDirty = false;
    document.getElementById('save-bar').style.display = 'none';
    showToast('Settings reset', 'success');
    close();
  });
}
