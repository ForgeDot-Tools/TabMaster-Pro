/**
 * TabMaster Pro — Settings Page Logic
 */

import { getSettings, saveSettings, getSessions, deleteSession, getCustomRules, addCustomRule, updateCustomRule, deleteCustomRule, saveCustomRules, tabMatchesRule } from '../utils/storage.js';
import {
  autoGroupByDomain, ungroupAllTabs, closeDuplicateTabs,
  closeInactiveTabs, hibernateTabs, BUILTIN_CATEGORIES
} from '../utils/tabManager.js';
import { importSession } from '../utils/sessionManager.js';

// ─── State ────────────────────────────────────────────────
let currentSettings = {};
let isDirty = false;
let importFileData = null;

const SECTION_LABELS = {
  general: { heading: 'General Settings', desc: 'Customize your TabMaster Pro experience' },
  grouping: { heading: 'Tab Grouping', desc: 'Configure auto-grouping behavior and exclusions' },
  cleanup: { heading: 'Tab Cleanup', desc: 'Manage stale and duplicate tab removal' },
  sessions: { heading: 'Session Management', desc: 'Save, restore, and import tab sessions' },
  notifications: { heading: 'Notifications', desc: 'Control when TabMaster sends alerts' },
  rules: { heading: 'Custom Group Rules', desc: 'Define smart rules to group tabs by URL pattern, hostname, title, or regex' },
  data: { heading: 'Data & Storage', desc: 'Manage your saved data and reset settings' },
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
  initRules();
  initTabInsights();
  initCategories();
  initCustomCategories();
  initGroupingWiring();
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
    });
  });
}

// ─── Populate Settings into UI ─────────────────────────────
function populateSettings(s) {
  // Theme
  document.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === s.theme);
  });

  // Toggles
  setToggle('setting-showTabCount', s.showTabCount);
  setToggle('setting-confirmBeforeCleanup', s.confirmBeforeCleanup);
  setToggle('setting-autoGroup', s.autoGroup);
  setToggle('setting-autoGroupOnStartup', s.autoGroupOnStartup);
  setToggle('setting-groupByDomain', s.groupByDomain !== false); // default true
  setToggle('setting-subdomainGrouping', s.subdomainGrouping);
  setToggle('setting-sortGroupsAlphabetically', s.sortGroupsAlphabetically);
  setToggle('setting-groupCollapseAfterSwitch', s.groupCollapseAfterSwitch);
  setToggle('setting-autoSaveSession', s.autoSaveSession);
  setToggle('setting-notificationsEnabled', s.notificationsEnabled);

  // Subdomain domain typed patterns — rendered into sd-pat-list
  sdDomPatterns = JSON.parse(JSON.stringify(s.subdomainDomains || []));
  renderSdPatList();

  // Sync visibility of child panels based on restored toggle states
  syncSubdomainChildVisibility();

  // Number inputs
  setNumber('setting-tabLimitWarning', s.tabLimitWarning);
  setNumber('setting-inactiveDays', s.inactiveDays);

  // Excluded domains
  const excludedEl = document.getElementById('setting-excludedDomains');
  if (excludedEl) excludedEl.value = (s.excludedDomains || []).join('\n');
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
  const excludedRaw = document.getElementById('setting-excludedDomains')?.value || '';
  const excludedDomains = excludedRaw
    .split('\n')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  const sdDomsRaw = document.getElementById('setting-subdomainDomains')?.value || '';
  const subdomainDomains = sdDomsRaw.split('\n').map((d) => d.trim().toLowerCase()).filter(Boolean);

  return {
    theme,
    showTabCount: getToggle('setting-showTabCount'),
    confirmBeforeCleanup: getToggle('setting-confirmBeforeCleanup'),
    autoGroup: getToggle('setting-autoGroup'),
    autoGroupOnStartup: getToggle('setting-autoGroupOnStartup'),
    groupByDomain: getToggle('setting-groupByDomain'),
    subdomainGrouping: getToggle('setting-subdomainGrouping'),
    subdomainDomains: JSON.parse(JSON.stringify(sdDomPatterns)),
    categoryOverrides: collectCategoryOverrides(),
    customCategories: collectCustomCategories(),
    sortGroupsAlphabetically: getToggle('setting-sortGroupsAlphabetically'),
    groupCollapseAfterSwitch: getToggle('setting-groupCollapseAfterSwitch'),
    autoSaveSession: getToggle('setting-autoSaveSession'),
    notificationsEnabled: getToggle('setting-notificationsEnabled'),
    tabLimitWarning: parseInt(document.getElementById('setting-tabLimitWarning')?.value || '20'),
    inactiveDays: parseInt(document.getElementById('setting-inactiveDays')?.value || '7'),
    excludedDomains,
  };
}

function getToggle(id) {
  return document.getElementById(id)?.checked || false;
}

// ─── Form Listeners (track dirty state) ────────────────────
function initFormListeners() {
  // Theme buttons
  document.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.theme-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      markDirty();
    });
  });

  // All checkboxes
  document.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    el.addEventListener('change', markDirty);
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
    if (!confirm('Close all inactive tabs?')) return;
    const win = await chrome.windows.getLastFocused();
    const days = parseInt(document.getElementById('setting-inactiveDays')?.value || '7');
    const count = await closeInactiveTabs(win?.id, days);
    setQaResult(count > 0 ? `✅ Closed ${count} inactive tab(s)` : 'No inactive tabs found');
  });

  document.getElementById('qa-ungroup-all')?.addEventListener('click', async () => {
    if (!confirm('Ungroup all tabs?')) return;
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

  // Clear activity
  document.getElementById('btn-clear-activity')?.addEventListener('click', async () => {
    if (!confirm('Clear tab activity log?')) return;
    await chrome.storage.local.remove('tabActivity');
    showToast('Activity log cleared', 'success');
    if (activitySizeEl) activitySizeEl.textContent = '0 tab record(s)';
  });

  // Clear sessions
  document.getElementById('btn-clear-sessions')?.addEventListener('click', async () => {
    if (!confirm('Delete ALL saved sessions? This cannot be undone.')) return;
    await chrome.storage.local.remove('sessions');
    showToast('All sessions deleted', 'success');
    if (sessionCountEl) sessionCountEl.textContent = '0 session(s)';
  });

  // Reset settings
  document.getElementById('btn-reset-settings')?.addEventListener('click', async () => {
    if (!confirm('Reset all settings to defaults? Your sessions will NOT be deleted.')) return;
    await chrome.storage.local.remove('settings');
    const defaults = await getSettings(); // returns defaults
    currentSettings = defaults;
    populateSettings(defaults);
    isDirty = false;
    document.getElementById('save-bar').style.display = 'none';
    showToast('Settings reset to defaults', 'success');
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

// ─── Custom Group Rules ────────────────────────────────────

const MATCH_TYPE_LABELS = {
  'url-contains':      { label: 'URL Contains',      hint: 'One per line — case-insensitive substring of the full URL' },
  'hostname-contains': { label: 'Hostname Contains',  hint: 'One per line — substring of the full hostname including subdomains' },
  'hostname-exact':    { label: 'Exact Hostname',     hint: 'One per line — exact match of the full subdomain (e.g. mail.google.com only, not drive.google.com)' },
  'base-domain':       { label: 'Base Domain',        hint: 'One per line — matches only the registrable domain, all subdomains match (e.g. google.com matches mail, drive, docs…)' },
  'title-contains':    { label: 'Tab Title Contains', hint: 'One per line — matched against the visible tab title text' },
  'regex':             { label: 'Regex (URL)',         hint: 'One regex per line — tested against the full URL (case-insensitive)' },
};

const GROUP_COLOR_HEX = {
  blue:'#4285f4', green:'#34a853', red:'#ea4335', yellow:'#fbbc04',
  pink:'#ff6d94', purple:'#a142f4', cyan:'#24c1e0', orange:'#ff8c00', grey:'#8b949e'
};

let editingRuleId = null; // null = creating new, string = editing existing
let selectedRuleColor = 'blue';
let selectedMatchType = 'url-contains';

function initRules() {
  renderRules();

  // Add rule button
  document.getElementById('btn-add-rule')?.addEventListener('click', () => openEditor(null));

  // Editor close buttons
  document.getElementById('btn-close-editor')?.addEventListener('click', closeEditor);
  document.getElementById('btn-cancel-rule')?.addEventListener('click', closeEditor);

  // Color picker
  document.querySelectorAll('.re-color-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('.re-color-dot').forEach((d) => d.classList.remove('active'));
      dot.classList.add('active');
      selectedRuleColor = dot.dataset.color;
    });
  });

  // Match type selector
  document.querySelectorAll('.match-type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.match-type-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMatchType = btn.dataset.type;
      // Update textarea hint
      const hint = MATCH_TYPE_LABELS[selectedMatchType]?.hint || '';
      const hintEl = document.getElementById('re-patterns-hint');
      if (hintEl) hintEl.textContent = `— ${hint}`;
      // Update placeholder
      const ta = document.getElementById('re-patterns');
      if (ta) {
        const placeholders = {
          'url-contains':      'bank.in\nhdfc\nsbi\nicici',
          'hostname-contains': 'hdfc.bank.in\nsbi.bank.in\nmail.google.com',
          'hostname-exact':    'mail.google.com\ndrive.google.com\ndocs.google.com',
          'base-domain':       'google.com\nbank.in\ngithub.com',
          'title-contains':    'HDFC\nSBI\nNet Banking',
          'regex':             '.*\\.bank\\.in.*\nhdfc|sbi|icici',
        };
        ta.placeholder = placeholders[selectedMatchType] || '';
      }
    });
  });

  // Test rule
  document.getElementById('btn-test-rule')?.addEventListener('click', async () => {
    const rule = collectEditorRule();
    if (!rule.patterns || rule.patterns.length === 0) {
      showToast('Add at least one pattern to test', 'error'); return;
    }
    const tabs = await chrome.tabs.query({});
    const matches = tabs.filter((t) => tabMatchesRule(t, { ...rule, enabled: true }));
    const resultEl = document.getElementById('re-test-result');
    if (!resultEl) return;
    resultEl.style.display = 'block';
    if (matches.length === 0) {
      resultEl.innerHTML = `<span style="color:var(--text-muted)">No open tabs match this rule right now.</span>`;
    } else {
      resultEl.innerHTML = `
        <strong style="color:var(--accent)">${matches.length} tab${matches.length !== 1 ? 's' : ''} would be grouped</strong>
        <div class="match-list">${matches.map((t) => `
          <div class="match-row">
            ${t.favIconUrl ? `<img class="match-favicon" src="${escHtml(t.favIconUrl)}" />` : ''}
            <span class="match-title">${escHtml(t.title || 'Untitled')}</span>
            <span class="match-url">${escHtml(t.url || '')}</span>
          </div>`).join('')}
        </div>`;
      // Hide broken favicons — CSP-safe: no inline handlers
      resultEl.querySelectorAll('img.match-favicon').forEach((img) => {
        img.addEventListener('error', () => { img.style.display = 'none'; });
      });
    }
  });

  // Save rule
  document.getElementById('btn-save-rule')?.addEventListener('click', async () => {
    const rule = collectEditorRule();
    if (!rule.name.trim()) { showToast('Please enter a group name', 'error'); return; }
    if (!rule.patterns || rule.patterns.length === 0) { showToast('Add at least one pattern', 'error'); return; }

    if (editingRuleId) {
      await updateCustomRule(editingRuleId, rule);
      showToast(`✅ Rule "${rule.name}" updated`, 'success');
    } else {
      await addCustomRule(rule);
      showToast(`✅ Rule "${rule.name}" created`, 'success');
    }
    closeEditor();
    await renderRules();
  });

  // Export rules
  document.getElementById('btn-export-rules')?.addEventListener('click', async () => {
    const rules = await getCustomRules();
    if (rules.length === 0) { showToast('No rules to export', ''); return; }
    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tabmaster-rules-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('✅ Rules exported', 'success');
  });

  // Import rules
  document.getElementById('rules-import-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (!Array.isArray(imported)) throw new Error('Invalid format');
      // Merge: assign new IDs to avoid collisions
      const existing = await getCustomRules();
      const merged = [
        ...existing,
        ...imported.map((r) => ({ ...r, id: `rule_${Date.now()}_${Math.random().toString(36).slice(2)}` }))
      ];
      await saveCustomRules(merged);
      await renderRules();
      showToast(`✅ Imported ${imported.length} rule(s)`, 'success');
    } catch {
      showToast('❌ Invalid rules file', 'error');
    }
    e.target.value = '';
  });
}

/** Open the editor, pre-filling for edit or blank for new */
function openEditor(rule) {
  editingRuleId = rule?.id || null;
  selectedRuleColor = rule?.color || 'blue';
  selectedMatchType = rule?.matchType || 'url-contains';

  // Set title
  const titleEl = document.getElementById('rule-editor-title');
  if (titleEl) titleEl.textContent = rule ? `Edit Rule — ${rule.name}` : 'New Rule';

  // Fill fields
  const nameEl = document.getElementById('re-name');
  if (nameEl) nameEl.value = rule?.name || '';

  const patternsEl = document.getElementById('re-patterns');
  if (patternsEl) patternsEl.value = (rule?.patterns || []).join('\n');

  const enabledEl = document.getElementById('re-enabled');
  if (enabledEl) enabledEl.checked = rule ? (rule.enabled !== false) : true;

  // Color dots
  document.querySelectorAll('.re-color-dot').forEach((d) => {
    d.classList.toggle('active', d.dataset.color === selectedRuleColor);
  });

  // Match type buttons
  document.querySelectorAll('.match-type-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.type === selectedMatchType);
  });

  // Update hint
  const hintEl = document.getElementById('re-patterns-hint');
  if (hintEl) hintEl.textContent = `— ${MATCH_TYPE_LABELS[selectedMatchType]?.hint || ''}`;

  // Clear test result
  const testResultEl = document.getElementById('re-test-result');
  if (testResultEl) { testResultEl.style.display = 'none'; testResultEl.innerHTML = ''; }

  document.getElementById('rule-editor').style.display = 'block';
  document.getElementById('re-name')?.focus();
}

function closeEditor() {
  document.getElementById('rule-editor').style.display = 'none';
  editingRuleId = null;
}

/** Collect current editor form into a rule object */
function collectEditorRule() {
  const patternsRaw = document.getElementById('re-patterns')?.value || '';
  const patterns = patternsRaw
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    name: (document.getElementById('re-name')?.value || '').trim(),
    color: selectedRuleColor,
    matchType: selectedMatchType,
    patterns,
    enabled: document.getElementById('re-enabled')?.checked !== false,
  };
}

/** Render the rules list */
async function renderRules() {
  const container = document.getElementById('rules-list');
  const emptyEl = document.getElementById('rules-empty');
  const rules = await getCustomRules();

  if (rules.length === 0) {
    container.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = 'flex'; container.appendChild(emptyEl); }
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  container.innerHTML = rules.map((rule, idx) => {
    const colorHex = GROUP_COLOR_HEX[rule.color] || '#8b949e';
    const matchLabel = MATCH_TYPE_LABELS[rule.matchType || 'url-contains']?.label || rule.matchType;
    const patternsPreview = (rule.patterns || []).join(', ');
    const isDisabled = rule.enabled === false;

    return `
    <div class="rule-card${isDisabled ? ' disabled' : ''}" data-id="${rule.id}">
      <div class="rule-priority-btns">
        <button class="priority-btn" data-action="up" data-idx="${idx}" title="Move up" ${idx === 0 ? 'disabled style="opacity:0.3"' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button class="priority-btn" data-action="down" data-idx="${idx}" title="Move down" ${idx === rules.length - 1 ? 'disabled style="opacity:0.3"' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>

      <div class="rule-swatch" style="background:${colorHex}"></div>

      <div class="rule-info">
        <div class="rule-card-name">${escHtml(rule.name)}</div>
        <div class="rule-card-meta">
          <span class="rule-badge">${rule.patterns?.length || 0} pattern${(rule.patterns?.length || 0) !== 1 ? 's' : ''}</span>
          <span class="rule-badge match-type">${matchLabel}</span>
          ${isDisabled ? '<span class="rule-badge" style="background:rgba(248,81,73,0.1);border-color:rgba(248,81,73,0.2);color:var(--danger)">Disabled</span>' : ''}
        </div>
        <div class="rule-patterns-preview" title="${escHtml(patternsPreview)}">${escHtml(patternsPreview)}</div>
      </div>

      <div class="rule-card-actions">
        <button class="rule-action-btn" data-action="toggle" data-id="${rule.id}" title="${isDisabled ? 'Enable' : 'Disable'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${isDisabled
            ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
            : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
          }</svg>
        </button>
        <button class="rule-action-btn" data-action="edit" data-id="${rule.id}" title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="rule-action-btn danger" data-action="delete" data-id="${rule.id}" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  // Attach action handlers
  container.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const rules = await getCustomRules();
      const rule = rules.find((r) => r.id === btn.dataset.id);
      if (rule) openEditor(rule);
    });
  });

  container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const rules = await getCustomRules();
      const rule = rules.find((r) => r.id === btn.dataset.id);
      if (!confirm(`Delete rule "${rule?.name || btn.dataset.id}"?`)) return;
      await deleteCustomRule(btn.dataset.id);
      await renderRules();
      showToast('Rule deleted', '');
    });
  });

  container.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const rules = await getCustomRules();
      const rule = rules.find((r) => r.id === btn.dataset.id);
      if (rule) {
        await updateCustomRule(rule.id, { enabled: rule.enabled === false });
        await renderRules();
      }
    });
  });

  container.querySelectorAll('[data-action="up"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.idx);
      const rules = await getCustomRules();
      if (idx > 0) {
        [rules[idx - 1], rules[idx]] = [rules[idx], rules[idx - 1]];
        await saveCustomRules(rules);
        await renderRules();
      }
    });
  });

  container.querySelectorAll('[data-action="down"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.idx);
      const rules = await getCustomRules();
      if (idx < rules.length - 1) {
        [rules[idx], rules[idx + 1]] = [rules[idx + 1], rules[idx]];
        await saveCustomRules(rules);
        await renderRules();
      }
    });
  });
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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

  // Clicking a summary card sets the matching filter
  document.getElementById('ti-card-dupes')?.addEventListener('click', () => setFilter('duplicates'));
  document.getElementById('ti-card-bg')?.addEventListener('click',   () => setFilter('background'));
  document.getElementById('ti-card-hibernated')?.addEventListener('click', () => setFilter('hibernated'));
  document.getElementById('ti-card-total')?.addEventListener('click', () => setFilter('all'));

  // Load when section first becomes visible
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      if (item.dataset.section === 'tabs' && tiAllTabs.length === 0) {
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

  // Hide broken favicons — CSP-safe: no inline onerror handlers
  list.querySelectorAll('img.ti-favicon').forEach((img) => {
    img.addEventListener('error', () => { img.style.display = 'none'; });
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
            await chrome.windows.update(tab.windowId, { focused: true });
            await chrome.tabs.update(tabId, { active: true });
          }
        } else if (act === 'close') {
          if (confirm('Close this tab?')) {
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
    if (!confirm(`Close ${tabs.length} duplicate tabs?`)) return;
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
    if (!confirm(`Hibernate ${tabs.length} background tabs?`)) return;
    for (const t of tabs) {
      try { await chrome.tabs.discard(t.id); } catch { /* skip active/pinned */ }
    }
    await loadTabInsights();
    showToast(`✅ Hibernated background tabs`, 'success');
  });

  document.getElementById('ti-bulk-close-inactive')?.addEventListener('click', async () => {
    if (!confirm(`Close ${tabs.length} inactive tabs? This cannot be undone.`)) return;
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

// In-memory state for category overrides (mutated by card interactions)
let catOverrideState = {}; // { [catId]: { enabled: bool, color: string } }

function initCategories() {
  // Categories are always active — no master toggle anymore.
  // Just seed state from saved settings and render.
  catOverrideState = JSON.parse(JSON.stringify(currentSettings.categoryOverrides || {}));
  renderCategoryCards();
}


function renderCategoryCards() {
  const grid = document.getElementById('category-cards-grid');
  if (!grid) return;

  grid.innerHTML = BUILTIN_CATEGORIES.map((cat) => {
    const ov           = catOverrideState[cat.id] || {};
    const enabled      = ov.enabled !== false;
    const color        = ov.color || cat.color;
    const extraPats    = ov.extraPatterns || [];

    const colorDots = CAT_COLORS.map((c) => `
      <button
        class="cat-color-dot ${c === color ? 'active' : ''}"
        data-cat="${cat.id}" data-color="${c}"
        style="background:${CAT_COLOR_HEX[c]}" title="${c}"
      ></button>
    `).join('');

    // Built-in pattern chips (read-only)
    const builtinChips = cat.patterns.map((p) =>
      `<span class="pat-chip pat-chip-builtin" title="Built-in pattern">${escHtml(p)}</span>`
    ).join('');

    // Custom extra pattern chips (removable)
    const extraChips = extraPats.map((p, i) => {
      const label = typeof p === 'string' ? escHtml(p) : `<span class="pat-type-badge">${escHtml(p.type)}</span>${escHtml(p.value)}`;
      return `
      <span class="pat-chip pat-chip-custom">
        ${label}
        <button class="pat-chip-remove" data-cat="${cat.id}" data-idx="${i}" title="Remove pattern">×</button>
      </span>
    `;
    }).join('');

    return `
    <div class="cat-card ${enabled ? '' : 'disabled'}" data-id="${cat.id}" data-color="${color}">
      <div class="cat-card-header">
        <span class="cat-emoji">${cat.emoji}</span>
        <span class="cat-name">${escHtml(cat.name)}</span>
        <label class="toggle cat-toggle">
          <input type="checkbox" class="cat-enabled-cb" data-cat="${cat.id}" ${enabled ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="cat-desc">${escHtml(cat.desc)}</div>
      <div class="cat-color-row">${colorDots}</div>

      <!-- Patterns panel -->
      <div class="cat-patterns-toggle" data-cat="${cat.id}">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 9.5L3.5 5 2 6.5l6 6 6-6L12.5 5z"/></svg>
        <span>View / edit patterns
          <span class="pat-count">${cat.patterns.length + extraPats.length} patterns · ${extraPats.length} custom</span>
        </span>
      </div>
      <div class="cat-patterns-panel" id="cat-panel-${cat.id}" style="display:none">
        <div class="pat-section-label">Built-in <span class="pat-hint">(read-only, matched against URL &amp; hostname)</span></div>
        <div class="pat-chips-row">${builtinChips}</div>
        <div class="pat-section-label" style="margin-top:8px">Custom patterns <span class="pat-hint">(your additions)</span></div>
        <div class="pat-chips-row pat-custom-row" id="pat-custom-${cat.id}">${extraChips || '<span class="pat-empty">None added yet</span>'}</div>
        <div class="pat-add-row">
          <select class="pat-type-sel input" id="pat-type-${cat.id}">
            <option value="url-contains">URL contains</option>
            <option value="hostname-contains">Host contains</option>
            <option value="hostname-exact">Host exact</option>
            <option value="base-domain">Base domain</option>
            <option value="regex">Regex</option>
          </select>
          <input
            class="pat-add-input input"
            id="pat-input-${cat.id}"
            placeholder="e.g. mybank.com"
            type="text"
          />
          <button class="btn btn-sm pat-add-btn" data-cat="${cat.id}">+ Add</button>
        </div>
      </div>
    </div>`;
  }).join('');

  // ── Wire all card interactions ─────────────────────────────

  // Enable/disable toggles
  grid.querySelectorAll('.cat-enabled-cb').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.cat;
      catOverrideState[id] = { ...(catOverrideState[id] || {}), enabled: cb.checked };
      grid.querySelector(`.cat-card[data-id="${id}"]`)?.classList.toggle('disabled', !cb.checked);
      markDirty();
    });
  });

  // Color dots
  grid.querySelectorAll('.cat-color-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      const { cat: id, color } = dot.dataset;
      catOverrideState[id] = { ...(catOverrideState[id] || {}), color };
      const card = grid.querySelector(`.cat-card[data-id="${id}"]`);
      if (card) {
        card.dataset.color = color;
        card.querySelectorAll('.cat-color-dot').forEach((d) =>
          d.classList.toggle('active', d.dataset.color === color)
        );
      }
      markDirty();
    });
  });

  // Patterns panel expand/collapse toggle
  grid.querySelectorAll('.cat-patterns-toggle').forEach((tog) => {
    tog.addEventListener('click', () => {
      const id    = tog.dataset.cat;
      const panel = document.getElementById(`cat-panel-${id}`);
      if (!panel) return;
      const open = panel.style.display === 'none';
      panel.style.display = open ? '' : 'none';
      tog.classList.toggle('open', open);
    });
  });

  // Add custom pattern
  grid.querySelectorAll('.pat-add-btn').forEach((btn) => {
    const id    = btn.dataset.cat;
    const input = document.getElementById(`pat-input-${id}`);

    const doAdd = () => {
      const val  = input?.value?.trim();
      if (!val) return;
      const typeEl = document.getElementById(`pat-type-${id}`);
      const type   = typeEl?.value || 'url-contains';
      const entry  = { type, value: val.toLowerCase() };
      const ov = catOverrideState[id] || {};
      const extra = [...(ov.extraPatterns || [])];
      // Dedup check
      if (extra.some((e) => typeof e === 'object' && e.type === type && e.value === entry.value)) {
        if (input) input.value = '';
        return;
      }
      extra.push(entry);
      catOverrideState[id] = { ...ov, extraPatterns: extra };
      if (input) input.value = '';
      refreshCustomChips(id, extra);
      updatePatCountLabel(id, extra);
      markDirty();
    };

    btn.addEventListener('click', doAdd);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
  });

  // Remove custom pattern (event delegation on grid)
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.pat-chip-remove');
    if (!btn) return;
    const { cat: id, idx } = btn.dataset;
    const ov    = catOverrideState[id] || {};
    const extra = [...(ov.extraPatterns || [])];
    extra.splice(parseInt(idx), 1);
    catOverrideState[id] = { ...ov, extraPatterns: extra };
    refreshCustomChips(id, extra);
    updatePatCountLabel(id, extra);
    markDirty();
  });
}

function refreshCustomChips(catId, extraPats) {
  const row = document.getElementById(`pat-custom-${catId}`);
  if (!row) return;
  if (extraPats.length === 0) {
    row.innerHTML = '<span class="pat-empty">None added yet</span>';
    return;
  }
  row.innerHTML = extraPats.map((p, i) => {
    const label = typeof p === 'string' ? escHtml(p) : `<span class="pat-type-badge">${escHtml(p.type)}</span> ${escHtml(p.value)}`;
    return `
      <span class="pat-chip pat-chip-custom">
        ${label}
        <button class="pat-chip-remove" data-cat="${catId}" data-idx="${i}" title="Remove">×</button>
      </span>
    `;
  }).join('');
}

function updatePatCountLabel(catId, extraPats) {
  const cat   = BUILTIN_CATEGORIES.find((c) => c.id === catId);
  const total = (cat?.patterns.length || 0) + extraPats.length;
  const tog   = document.querySelector(`.cat-patterns-toggle[data-cat="${catId}"] .pat-count`);
  if (tog) tog.textContent = `${total} patterns · ${extraPats.length} custom`;
}

function collectCategoryOverrides() {
  return JSON.parse(JSON.stringify(catOverrideState));
}

// ─── Custom Categories ────────────────────────────────────────────────────────

let customCatState = []; // [{ id, name, emoji, color, patterns[] }]

const EMOJI_OPTIONS = ['📁','⭐','🔥','💡','🎯','🛡️','🌐','🏠','📊','🔧','🎮','📚','💰','🚀','🌍','🔑','📦','🎨'];

function initCustomCategories() {
  // Seed from saved settings
  customCatState = JSON.parse(JSON.stringify(currentSettings.customCategories || []));

  renderCustomCategoryList();

  // Wire the "+ New Category" button
  document.getElementById('btn-add-custom-cat')?.addEventListener('click', () => {
    openCustomCatEditor(null);
  });
}

function renderCustomCategoryList() {
  const list = document.getElementById('custom-cat-list');
  if (!list) return;

  if (customCatState.length === 0) {
    list.innerHTML = `<div class="cc-empty">No custom categories yet. Click <strong>+ New Category</strong> to create one.</div>`;
    return;
  }

  list.innerHTML = customCatState.map((cat, idx) => {
    const patCount = (cat.patterns || []).length;
    return `
    <div class="cc-card" data-idx="${idx}" data-color="${cat.color || 'blue'}">
      <div class="cc-card-left">
        <span class="cc-emoji">${escHtml(cat.emoji || '📁')}</span>
        <div class="cc-card-info">
          <div class="cc-card-name">${escHtml(cat.name || 'Unnamed')}</div>
          <div class="cc-card-meta">${patCount} pattern${patCount !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <div class="cc-card-right">
        <button class="btn btn-sm btn-secondary cc-edit-btn" data-idx="${idx}">Edit</button>
        <button class="btn btn-sm btn-danger-outline cc-del-btn" data-idx="${idx}" title="Delete category">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.cc-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => openCustomCatEditor(parseInt(btn.dataset.idx)));
  });

  list.querySelectorAll('.cc-del-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      customCatState.splice(idx, 1);
      renderCustomCategoryList();
      markDirty();
    });
  });
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
    } else {
      customCatState[idx] = updated;
    }

    overlay.remove();
    renderCustomCategoryList();
    markDirty();
    showToast(isNew ? 'Category created' : 'Category saved', 'success');
  });
}

function collectCustomCategories() {
  return JSON.parse(JSON.stringify(customCatState));
}

// ─── Grouping Section Wiring ──────────────────────────────────────────────────
// Handles: Group by Domain → shows/hides subdomain row
//          Group by Subdomain → shows/hides "Always split" pattern panel
//          Subdomain domain typed patterns (sd-pat-*) + regex validator

let sdDomPatterns = []; // [{ type, value } | string] — in-memory typed patterns

function syncSubdomainChildVisibility() {
  const groupByDomEl  = document.getElementById('setting-groupByDomain');
  const subdomainEl   = document.getElementById('setting-subdomainGrouping');
  const subdomainWrap = document.getElementById('subdomain-grouping-wrap');
  const domainsWrap   = document.getElementById('subdomain-domains-wrap');

  const domainOn    = groupByDomEl?.checked !== false;
  const subdomainOn = subdomainEl?.checked;

  if (subdomainWrap) subdomainWrap.style.display = domainOn ? '' : 'none';
  if (domainsWrap)   domainsWrap.style.display   = (domainOn && subdomainOn) ? '' : 'none';
}

function renderSdPatList() {
  const list = document.getElementById('sd-pat-list');
  if (!list) return;
  if (sdDomPatterns.length === 0) {
    list.innerHTML = '<div class="pat-empty" style="padding:4px 0">No patterns yet.</div>';
    return;
  }
  list.innerHTML = sdDomPatterns.map((p, i) => {
    const type  = typeof p === 'string' ? 'base-domain' : p.type;
    const value = typeof p === 'string' ? p : p.value;
    return `
      <div class="cc-pat-row">
        <span class="pat-type-badge">${escHtml(type)}</span>
        <span class="cc-pat-val">${escHtml(value)}</span>
        <button class="pat-chip-remove sd-pat-del" data-idx="${i}" title="Remove">×</button>
      </div>`;
  }).join('');

  list.querySelectorAll('.sd-pat-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      sdDomPatterns.splice(parseInt(btn.dataset.idx), 1);
      renderSdPatList();
      markDirty();
    });
  });
}

function initGroupingWiring() {
  // ── Group by Domain parent toggle → show/hide subdomain row ──────────────
  document.getElementById('setting-groupByDomain')?.addEventListener('change', () => {
    syncSubdomainChildVisibility();
    markDirty();
  });

  // ── Group by Subdomain toggle → show/hide "Always split" panel ───────────
  document.getElementById('setting-subdomainGrouping')?.addEventListener('change', () => {
    syncSubdomainChildVisibility();
    markDirty();
  });

  // ── Subdomain domain typed patterns ──────────────────────────────────────
  const sdTypeEl  = document.getElementById('sd-pat-type');
  const sdInputEl = document.getElementById('sd-pat-input');
  const sdAddBtn  = document.getElementById('sd-pat-add-btn');

  // Show/hide regex validator when type changes
  function syncRegexValidator() {
    const validator = document.getElementById('sd-regex-validator');
    if (validator) validator.style.display = sdTypeEl?.value === 'regex' ? '' : 'none';
    updateRegexResult();
  }

  function updateRegexResult() {
    const resultEl  = document.getElementById('sd-regex-result');
    const testInput = document.getElementById('sd-regex-test-url');
    if (!resultEl || !testInput || sdTypeEl?.value !== 'regex') return;

    const pattern = sdInputEl?.value?.trim();
    const testUrl = testInput.value.trim();

    if (!pattern) { resultEl.textContent = '—'; resultEl.className = 'regex-val-result'; return; }

    let valid = true;
    let matches = false;
    try {
      matches = new RegExp(pattern, 'i').test(testUrl || '');
    } catch {
      valid = false;
    }

    if (!valid) {
      resultEl.textContent = '⚠ Invalid regex';
      resultEl.className = 'regex-val-result invalid';
    } else if (!testUrl) {
      resultEl.textContent = '← paste a hostname to test';
      resultEl.className = 'regex-val-result neutral';
    } else {
      resultEl.textContent = matches ? '✓ Matches' : '✗ No match';
      resultEl.className   = `regex-val-result ${matches ? 'match' : 'nomatch'}`;
    }
  }

  sdTypeEl?.addEventListener('change', syncRegexValidator);
  sdInputEl?.addEventListener('input', updateRegexResult);
  document.getElementById('sd-regex-test-url')?.addEventListener('input', updateRegexResult);

  const doAddSdPat = () => {
    const val  = sdInputEl?.value?.trim();
    if (!val) { sdInputEl?.focus(); return; }
    const type = sdTypeEl?.value || 'base-domain';
    const entry = { type, value: val.toLowerCase() };

    // Dedup
    if (sdDomPatterns.some((p) => {
      const pt = typeof p === 'string' ? 'base-domain' : p.type;
      const pv = typeof p === 'string' ? p : p.value;
      return pt === type && pv === entry.value;
    })) {
      if (sdInputEl) sdInputEl.value = '';
      return;
    }

    sdDomPatterns.push(entry);
    if (sdInputEl) sdInputEl.value = '';
    renderSdPatList();
    markDirty();
  };

  sdAddBtn?.addEventListener('click', doAddSdPat);
  sdInputEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAddSdPat(); } });
}
