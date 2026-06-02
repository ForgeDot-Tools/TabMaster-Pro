/**
 * TabMaster Pro — Popup Logic
 */

import { getSettings, markProgrammaticTabs } from '../utils/storage.js';
import {
  autoGroupByDomain, groupTabs, ungroupAllTabs,
  closeDuplicateTabs, closeInactiveTabs, hibernateTabs,
  closeOtherTabs, getTabStats, getGroupsWithTabs, GROUP_COLORS
} from '../utils/tabManager.js';
import {
  saveCurrentSession, restoreSession, getSessions, deleteSession, exportSession
} from '../utils/sessionManager.js';
import { customConfirm } from '../utils/ui.js';

// ─── State ────────────────────────────────────────────────
let currentWindowId = null;
let selectedColor = 'blue';
let settings = {};

// ─── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const win = await chrome.windows.getCurrent();
  currentWindowId = win?.id;
  settings = await getSettings();

  const theme = settings.theme || 'dark';
  if (theme === 'system') {
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }

  await refreshTabCount();
  await renderGroups();
  await renderStats();

  initTabNav();
  initGroupControls();
  initCleanup();
  initSessions();
  initHeader();
});

// ─── Tab Navigation ────────────────────────────────────────
function initTabNav() {
  document.querySelectorAll('.tab-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-nav-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const panelId = `panel-${btn.dataset.tab}`;
      document.getElementById(panelId)?.classList.add('active');

      // Refresh data on tab switch
      if (btn.dataset.tab === 'groups') renderGroups();
      if (btn.dataset.tab === 'sessions') renderSessions();
      if (btn.dataset.tab === 'stats') renderStats();
    });
  });
}

// ─── Header ────────────────────────────────────────────────
function initHeader() {
  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
}

// ─── Tab Count ─────────────────────────────────────────────
async function refreshTabCount() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const el = document.getElementById('tab-count');
  if (el) {
    el.textContent = `${tabs.length} tab${tabs.length !== 1 ? 's' : ''} open`;
  }
}

// ─── Groups Panel ──────────────────────────────────────────
function initGroupControls() {
  // Toggle create group card
  document.getElementById('toggle-create-group').addEventListener('click', () => {
    const body = document.getElementById('create-group-body');
    const chevron = document.querySelector('#toggle-create-group .chevron');
    body.classList.toggle('collapsed');
    chevron.style.transform = body.classList.contains('collapsed') ? '' : 'rotate(180deg)';
  });

  // Color picker
  document.querySelectorAll('.color-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('active'));
      dot.classList.add('active');
      selectedColor = dot.dataset.color;
    });
  });

  // Auto-group
  document.getElementById('btn-auto-group').addEventListener('click', async () => {
    const btn = document.getElementById('btn-auto-group');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Grouping…';
    try {
      const results = await autoGroupByDomain(currentWindowId, true);
      await renderGroups();
      showToast(`✅ Created ${results.length} group${results.length !== 1 ? 's' : ''}`, 'success');
    } catch (e) {
      showToast('❌ Failed to group tabs', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>Auto Group`;
    }
  });

  // Ungroup all
  document.getElementById('btn-ungroup-all').addEventListener('click', async () => {
    const count = await ungroupAllTabs(currentWindowId);
    await renderGroups();
    showToast(`Ungrouped ${count} tab${count !== 1 ? 's' : ''}`, 'success');
  });

  // Group selected
  document.getElementById('btn-group-selected').addEventListener('click', async () => {
    const name = document.getElementById('group-name-input').value.trim() || 'My Group';
    const highlighted = await chrome.tabs.query({ currentWindow: true, highlighted: true });
    if (!highlighted || highlighted.length === 0) {
      showToast('Select tabs in the browser first', 'error');
      return;
    }
    const ids = highlighted.map((t) => t.id);
    await groupTabs(ids, name, selectedColor, currentWindowId);
    await renderGroups();
    showToast(`Grouped ${ids.length} tab${ids.length !== 1 ? 's' : ''} into "${name}"`, 'success');
    document.getElementById('group-name-input').value = '';
  });
}

async function renderGroups() {
  const container = document.getElementById('groups-list');
  const empty = document.getElementById('groups-empty');
  const groups = await getGroupsWithTabs(currentWindowId);

  const realGroups = groups.filter((g) => g.id !== -1);

  if (realGroups.length === 0) {
    container.innerHTML = '';
    if (empty) { empty.style.display = 'flex'; container.appendChild(empty); }
    return;
  }

  if (empty) empty.style.display = 'none';

  container.innerHTML = realGroups.map((group) => {
    const colorHex = getGroupColorHex(group.color);
    return `
      <div class="group-item" data-group-id="${group.id}">
        <div class="group-color-dot" style="background:${colorHex}"></div>
        <div class="group-info">
          <div class="group-name">${escHtml(group.title || 'Unnamed Group')}</div>
          <div class="group-meta">${group.tabs.length} tab${group.tabs.length !== 1 ? 's' : ''} · ${group.color}</div>
        </div>
        <div class="group-actions">
          <button class="group-action-btn" data-action="collapse" data-group="${group.id}" title="${group.collapsed ? 'Expand' : 'Collapse'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="${group.collapsed ? '9 18 15 12 9 6' : '6 9 12 15 18 9'}"/></svg>
          </button>
          <button class="group-action-btn" data-action="ungroup" data-group="${group.id}" title="Ungroup">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Attach handlers
  container.querySelectorAll('[data-action="collapse"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const gId = parseInt(btn.dataset.group);
      const g = await chrome.tabGroups.get(gId);
      await chrome.tabGroups.update(gId, { collapsed: !g.collapsed });
      await renderGroups();
    });
  });

  container.querySelectorAll('[data-action="ungroup"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const gId = parseInt(btn.dataset.group);
      const tabs = await chrome.tabs.query({ groupId: gId });
      if (tabs.length > 0) {
        const tabIds = tabs.map((t) => t.id);
        await markProgrammaticTabs(tabIds);
        await chrome.tabs.ungroup(tabIds);
      }
      await renderGroups();
      showToast('Group disbanded', 'success');
    });
  });
}

// ─── Cleanup Panel ─────────────────────────────────────────
function initCleanup() {
  const inactiveDesc = document.getElementById('inactive-desc');
  if (inactiveDesc) {
    inactiveDesc.textContent = `Not visited in ${settings.inactiveDays || 7} days`;
  }

  document.getElementById('btn-close-dupes').addEventListener('click', async () => {
    if (settings.confirmBeforeCleanup && !(await customConfirm('Close all duplicate tabs?', 'Cleanup Tabs', 'Close Tabs', true))) return;
    const count = await closeDuplicateTabs(currentWindowId);
    await refreshTabCount();
    showToast(count > 0 ? `✅ Closed ${count} duplicate${count !== 1 ? 's' : ''}` : 'No duplicates found', count > 0 ? 'success' : '');
  });

  document.getElementById('btn-close-inactive').addEventListener('click', async () => {
    const days = settings.inactiveDays || 7;
    if (settings.confirmBeforeCleanup && !(await customConfirm(`Close tabs inactive for ${days}+ days?`, 'Cleanup Tabs', 'Close Tabs', true))) return;
    const count = await closeInactiveTabs(currentWindowId);
    await refreshTabCount();
    showToast(count > 0 ? `✅ Closed ${count} inactive tab${count !== 1 ? 's' : ''}` : 'No inactive tabs found', count > 0 ? 'success' : '');
  });

  document.getElementById('btn-hibernate').addEventListener('click', async () => {
    const count = await hibernateTabs(currentWindowId);
    showToast(`💤 Hibernated ${count} tab${count !== 1 ? 's' : ''}`, 'success');
  });

  document.getElementById('btn-close-others').addEventListener('click', async () => {
    if (!(await customConfirm('Close all tabs except the active one?', 'Close Other Tabs', 'Close Tabs', true))) return;
    const count = await closeOtherTabs(currentWindowId);
    await refreshTabCount();
    showToast(`✅ Closed ${count} tab${count !== 1 ? 's' : ''}`, 'success');
  });
}

// ─── Sessions Panel ────────────────────────────────────────
function initSessions() {
  renderSessions();

  document.getElementById('btn-save-session').addEventListener('click', () => {
    const row = document.getElementById('session-name-row');
    row.style.display = 'flex';
    document.getElementById('session-name-input').focus();
  });

  document.getElementById('btn-cancel-save').addEventListener('click', () => {
    document.getElementById('session-name-row').style.display = 'none';
    document.getElementById('session-name-input').value = '';
  });

  document.getElementById('btn-confirm-save').addEventListener('click', async () => {
    const name = document.getElementById('session-name-input').value.trim() ||
      `Session ${new Date().toLocaleString()}`;
    const btn = document.getElementById('btn-confirm-save');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await saveCurrentSession(name, currentWindowId);
      document.getElementById('session-name-row').style.display = 'none';
      document.getElementById('session-name-input').value = '';
      await renderSessions();
      showToast('✅ Session saved!', 'success');
    } catch (e) {
      showToast('❌ Failed to save session', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  });

  // Enter key to save
  document.getElementById('session-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-confirm-save').click();
    if (e.key === 'Escape') document.getElementById('btn-cancel-save').click();
  });
}

async function renderSessions() {
  const container = document.getElementById('sessions-list');
  const empty = document.getElementById('sessions-empty');
  const sessions = await getSessions();

  if (!sessions || sessions.length === 0) {
    container.innerHTML = '';
    if (empty) { empty.style.display = 'flex'; container.appendChild(empty); }
    return;
  }

  if (empty) empty.style.display = 'none';

  container.innerHTML = sessions.map((session) => {
    const date = new Date(session.createdAt).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    return `
      <div class="session-item" data-id="${session.id}">
        <div class="session-header">
          <div class="session-name" title="${escHtml(session.name)}">${escHtml(session.name)}</div>
          <div class="session-actions">
            <button class="session-btn primary" data-action="restore" data-id="${session.id}">Restore</button>
            <button class="session-btn" data-action="export" data-id="${session.id}">Export</button>
            <button class="session-btn danger-btn" data-action="delete" data-id="${session.id}">✕</button>
          </div>
        </div>
        <div class="session-meta">${date} · ${session.tabCount} tab${session.tabCount !== 1 ? 's' : ''}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-action="restore"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.textContent = 'Opening…';
      btn.disabled = true;
      try {
        await restoreSession(btn.dataset.id, true);
        showToast('✅ Session restored in new window', 'success');
        window.close();
      } catch (e) {
        showToast('❌ Failed to restore session', 'error');
        btn.textContent = 'Restore';
        btn.disabled = false;
      }
    });
  });

  container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await customConfirm('Delete this session?', 'Delete Session', 'Delete', true))) return;
      await deleteSession(btn.dataset.id);
      await renderSessions();
      showToast('Session deleted', '');
    });
  });

  container.querySelectorAll('[data-action="export"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const json = await exportSession(btn.dataset.id);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tabmaster-session-${btn.dataset.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('✅ Session exported', 'success');
      } catch {
        showToast('❌ Export failed', 'error');
      }
    });
  });
}

// ─── Stats Panel ───────────────────────────────────────────
async function renderStats() {
  const stats = await getTabStats(currentWindowId);
  document.getElementById('stat-total').textContent = stats.totalTabs;
  document.getElementById('stat-groups').textContent = stats.groupCount;
  document.getElementById('stat-pinned').textContent = stats.pinnedCount;
  document.getElementById('stat-hibernated').textContent = stats.discardedCount;

  const domainsEl = document.getElementById('top-domains');
  if (!stats.topDomains || stats.topDomains.length === 0) {
    domainsEl.innerHTML = '<div class="empty-state" style="padding:16px"><p>Open some tabs to see domain stats.</p></div>';
    return;
  }
  const max = stats.topDomains[0][1];
  domainsEl.innerHTML = stats.topDomains.map(([domain, count]) => `
    <div class="domain-row">
      <div class="domain-label" title="${escHtml(domain)}">${escHtml(domain)}</div>
      <div class="domain-bar-wrap">
        <div class="domain-bar" style="width:${Math.round((count / max) * 100)}%"></div>
      </div>
      <div class="domain-count">${count}</div>
    </div>
  `).join('');
}

// ─── Toast ─────────────────────────────────────────────────
let toastTimer = null;
function showToast(message, type = '') {
  const toast = document.getElementById('global-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `global-toast show${type ? ` ${type}` : ''}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ─── Helpers ──────────────────────────────────────────────
function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"'/]/g, (s) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;'
  }[s]));
}

const GROUP_COLOR_MAP = {
  grey: '#8b949e', blue: '#4285f4', red: '#ea4335', yellow: '#fbbc04',
  green: '#34a853', pink: '#ff6d94', purple: '#a142f4', cyan: '#24c1e0', orange: '#ff8c00'
};

function getGroupColorHex(name) {
  return GROUP_COLOR_MAP[name] || '#8b949e';
}
