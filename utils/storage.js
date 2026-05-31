import { getDomain } from '../utils/tabManager.js';

// Note: getDomain is imported from tabManager to reuse the same registrable-domain logic.

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  autoGroup: false,
  autoGroupOnStartup: false,
  groupByDomain: true,            // domain-based fallback grouping on/off
  subdomainGrouping: false,       // false = base domain; true = separate per subdomain
  subdomainDomains: [],           // typed patterns [{ type, value }] — these hosts always use subdomain mode
  categoryOverrides: {},          // { catId: { enabled: bool, color: string, extraPatterns[] } }
  customCategories: [],           // user-defined categories: [{ id, name, emoji, color, patterns[] }]
  inactiveDays: 7,
  tabLimitWarning: 20,
  excludedDomains: [],
  groupColors: {},
  showTabCount: true,
  confirmBeforeCleanup: true,
  autoSaveSession: false,
  notificationsEnabled: true,
  groupCollapseAfterSwitch: false,
  sortGroupsAlphabetically: false,
};

/**
 * Get all settings, merged with defaults.
 */
export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('settings', (result) => {
      const stored = result.settings || {};

      // ── Migration: remove old categoryGrouping toggle (categories are always on now) ──
      if ('categoryGrouping' in stored) {
        delete stored.categoryGrouping;
      }

      // ── Migration: convert old string[] subdomainDomains → { type, value }[] ──
      if (Array.isArray(stored.subdomainDomains)) {
        stored.subdomainDomains = stored.subdomainDomains.map((d) =>
          typeof d === 'string'
            ? { type: 'base-domain', value: d.trim().toLowerCase() }
            : d
        );
      }

      const settings = { ...DEFAULT_SETTINGS, ...stored };
      resolve(settings);
    });
  });
}

/**
 * Save settings (merges with existing).
 */
export async function saveSettings(partial) {
  const current = await getSettings();
  const merged = { ...current, ...partial };
  return new Promise((resolve) => {
    chrome.storage.local.set({ settings: merged }, resolve);
  });
}

/**
 * Get all saved sessions.
 */
export async function getSessions() {
  return new Promise((resolve) => {
    chrome.storage.local.get('sessions', (result) => {
      resolve(result.sessions || []);
    });
  });
}

/**
 * Save a new session.
 */
export async function saveSession(session) {
  const sessions = await getSessions();
  sessions.unshift(session); // newest first
  return new Promise((resolve) => {
    chrome.storage.local.set({ sessions }, resolve);
  });
}

/**
 * Delete a session by id.
 */
export async function deleteSession(id) {
  const sessions = await getSessions();
  const filtered = sessions.filter((s) => s.id !== id);
  return new Promise((resolve) => {
    chrome.storage.local.set({ sessions: filtered }, resolve);
  });
}

/**
 * Get tab activity timestamps { tabId: lastActiveTimestamp }.
 */
export async function getTabActivity() {
  return new Promise((resolve) => {
    chrome.storage.local.get('tabActivity', (result) => {
      resolve(result.tabActivity || {});
    });
  });
}

/**
 * Update tab activity timestamp.
 */
export async function updateTabActivity(tabId) {
  const activity = await getTabActivity();
  activity[tabId] = Date.now();
  return new Promise((resolve) => {
    chrome.storage.local.set({ tabActivity: activity }, resolve);
  });
}

/**
 * Prune tab activity for tabs that no longer exist.
 */
export async function pruneTabActivity() {
  const tabs = await chrome.tabs.query({});
  const validIds = new Set(tabs.map((t) => String(t.id)));
  const activity = await getTabActivity();
  const pruned = {};
  for (const [id, ts] of Object.entries(activity)) {
    if (validIds.has(id)) pruned[id] = ts;
  }
  return new Promise((resolve) => {
    chrome.storage.local.set({ tabActivity: pruned }, resolve);
  });
}

// ─── Custom Group Rules ───────────────────────────────────────────────────────
//
// Rule shape:
// {
//   id: 'rule_<timestamp>',
//   name: 'Banking',          // Group title shown in Chrome
//   color: 'green',           // Chrome tab group color
//   patterns: ['bank.in', 'hdfc', 'sbi', 'icici'],  // URL substrings (case-insensitive)
//   matchField: 'url'         // 'url' | 'hostname' — where to apply patterns
// }

/**
 * Get all custom group rules.
 */
export async function getCustomRules() {
  return new Promise((resolve) => {
    chrome.storage.local.get('customRules', (result) => {
      resolve(result.customRules || []);
    });
  });
}

/**
 * Save the full custom rules array (replaces all).
 */
export async function saveCustomRules(rules) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ customRules: rules }, resolve);
  });
}

/**
 * Add a new custom rule.
 */
export async function addCustomRule(rule) {
  const rules = await getCustomRules();
  const newRule = { ...rule, id: `rule_${Date.now()}` };
  rules.push(newRule);
  await saveCustomRules(rules);
  return newRule;
}

/**
 * Update an existing rule by id.
 */
export async function updateCustomRule(id, changes) {
  const rules = await getCustomRules();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx !== -1) rules[idx] = { ...rules[idx], ...changes };
  await saveCustomRules(rules);
}

/**
 * Delete a custom rule by id.
 */
export async function deleteCustomRule(id) {
  const rules = await getCustomRules();
  await saveCustomRules(rules.filter((r) => r.id !== id));
}

/**
 * Check if a tab matches a given rule, respecting its matchType.
 *
 * Match types:
 *  'url-contains'      — case-insensitive substring of the full URL
 *  'hostname-contains' — case-insensitive substring of the full hostname (incl. subdomains)
 *  'hostname-exact'    — exact full hostname match (e.g. mail.google.com only)
 *  'base-domain'       — matches the registrable domain (e.g. google.com matches mail.google.com)
 *  'title-contains'    — case-insensitive substring of the tab title
 *  'regex'             — full regex tested against the URL
 */
export function tabMatchesRule(tab, rule) {
  if (rule.enabled === false) return false; // skip disabled rules
  if (!rule.patterns || rule.patterns.length === 0) return false;

  const matchType = rule.matchType || 'url-contains';
  let haystack = '';

  if (matchType === 'url-contains' || matchType === 'regex') {
    haystack = (tab.url || '').toLowerCase();
  } else if (matchType === 'hostname-contains' || matchType === 'hostname-exact') {
    try { haystack = new URL(tab.url).hostname.toLowerCase(); } catch { return false; }
  } else if (matchType === 'base-domain') {
    haystack = getDomain(tab.url) || ''; // e.g. 'google.com', 'bank.in'
  } else if (matchType === 'title-contains') {
    haystack = (tab.title || '').toLowerCase();
  }

  return rule.patterns.some((p) => {
    const pattern = p.trim().toLowerCase();
    if (!pattern) return false;
    if (matchType === 'regex') {
      try { return new RegExp(p.trim(), 'i').test(tab.url || ''); } catch { return false; }
    }
    if (matchType === 'hostname-exact') {
      return haystack === pattern; // must be exact, not just contains
    }
    return haystack.includes(pattern);
  });
}

/**
 * Mark tab IDs as programmatically grouped/ungrouped.
 */
export async function markProgrammaticTabs(tabIds) {
  const store = chrome.storage.session || chrome.storage.local;
  return new Promise((resolve) => {
    store.get('programmaticTabIds', (res) => {
      const current = res.programmaticTabIds || [];
      const merged = Array.from(new Set([...current, ...tabIds]));
      store.set({ programmaticTabIds: merged }, resolve);
    });
  });
}

/**
 * Check if a tab ID was programmatic, and remove it from the list.
 */
export async function popProgrammaticTab(tabId) {
  const store = chrome.storage.session || chrome.storage.local;
  return new Promise((resolve) => {
    store.get('programmaticTabIds', (res) => {
      const current = res.programmaticTabIds || [];
      const index = current.indexOf(tabId);
      if (index !== -1) {
        current.splice(index, 1);
        store.set({ programmaticTabIds: current }, () => resolve(true));
      } else {
        resolve(false);
      }
    });
  });
}

/**
 * Record a tab ID as manually grouped/ungrouped by the user.
 */
export async function markTabAsManuallyGrouped(tabId) {
  const store = chrome.storage.session || chrome.storage.local;
  return new Promise((resolve) => {
    store.get('manuallyGroupedTabIds', (res) => {
      const current = res.manuallyGroupedTabIds || [];
      if (!current.includes(tabId)) {
        current.push(tabId);
        store.set({ manuallyGroupedTabIds: current }, resolve);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Check if a tab was manually modified by the user.
 */
export async function isTabManuallyGrouped(tabId) {
  const store = chrome.storage.session || chrome.storage.local;
  return new Promise((resolve) => {
    store.get('manuallyGroupedTabIds', (res) => {
      const current = res.manuallyGroupedTabIds || [];
      resolve(current.includes(tabId));
    });
  });
}

/**
 * Remove tab ID from manually grouped tracking when it is closed.
 */
export async function forgetManuallyGroupedTab(tabId) {
  const store = chrome.storage.session || chrome.storage.local;
  return new Promise((resolve) => {
    store.get('manuallyGroupedTabIds', (res) => {
      const current = res.manuallyGroupedTabIds || [];
      const index = current.indexOf(tabId);
      if (index !== -1) {
        current.splice(index, 1);
        store.set({ manuallyGroupedTabIds: current }, resolve);
      } else {
        resolve();
      }
    });
  });
}
