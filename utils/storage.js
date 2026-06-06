import { getDomain, BUILTIN_CATEGORIES } from '../utils/tabManager.js';

// Note: getDomain is imported from tabManager to reuse the same registrable-domain logic.

export const DEFAULT_SETTINGS = {
  theme: 'system',
  autoGroup: false,
  autoGroupOnStartup: false,
  groupByDomain: true,            // domain-based fallback grouping on/off
  subdomainGrouping: false,       // false = base domain; true = separate per subdomain
  subdomainDomains: [],           // string array of hostnames for subdomain whitelist
  categoryOverrides: {},          // { catId: { enabled: bool, color: string, extraPatterns[] } }
  customCategories: [],           // user-defined categories: [{ id, name, emoji, color, patterns[] }]
  categoryOrder: [],              // ordered array of category IDs
  inactiveDays: 7,
  groupSingleTabs: false,
  sortTabsAndGroups: true,
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

let memorySettings = null;

// Keep memory caches in sync across contexts (background, popup, settings)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.settings) {
      memorySettings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    }
    if (changes.tabActivity) {
      memoryTabActivity = changes.tabActivity.newValue || {};
    }
  }
});

/**
 * Get all settings, merged with defaults.
 */
export async function getSettings() {
  if (memorySettings) return memorySettings;
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

      // ── Migration: ensure categoryOrder exists and contains all known categories ──
      if (!Array.isArray(stored.categoryOrder) || stored.categoryOrder.length === 0) {
        stored.categoryOrder = BUILTIN_CATEGORIES.map(c => c.id).concat((stored.customCategories || []).map(c => c.id));
      } else {
        // Append any new built-in categories or custom categories not in order
        const orderSet = new Set(stored.categoryOrder);
        const missing = [];
        for (const cat of BUILTIN_CATEGORIES) if (!orderSet.has(cat.id)) missing.push(cat.id);
        for (const cat of (stored.customCategories || [])) if (!orderSet.has(cat.id)) missing.push(cat.id);
        if (missing.length > 0) stored.categoryOrder.push(...missing);
      }

      memorySettings = { ...DEFAULT_SETTINGS, ...stored };
      resolve(memorySettings);
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

let memoryTabActivity = null;
let activityFlushTimeout = null;

/**
 * Get tab activity timestamps { tabId: lastActiveTimestamp }.
 */
export async function getTabActivity() {
  if (memoryTabActivity) return memoryTabActivity;
  return new Promise((resolve) => {
    chrome.storage.local.get('tabActivity', (result) => {
      memoryTabActivity = result.tabActivity || {};
      resolve(memoryTabActivity);
    });
  });
}

/**
 * Update tab activity timestamp (debounced to save I/O).
 */
export async function updateTabActivity(tabId) {
  const activity = await getTabActivity();
  activity[tabId] = Date.now();
  
  if (activityFlushTimeout) clearTimeout(activityFlushTimeout);
  activityFlushTimeout = setTimeout(() => {
    chrome.storage.local.set({ tabActivity: memoryTabActivity });
  }, 10000); // Flush every 10 seconds max
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
  memoryTabActivity = pruned;
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

// ─── Analytics / Stats ────────────────────────────────────────────────────────

/**
 * Get heuristic cache.
 */
export async function getHeuristicCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get('heuristicCache', (result) => {
      resolve(result.heuristicCache || {});
    });
  });
}

/**
 * Save to heuristic cache.
 */
export async function setHeuristicCache(domain, catId) {
  const cache = await getHeuristicCache();
  cache[domain] = catId;
  return new Promise((resolve) => {
    chrome.storage.local.set({ heuristicCache: cache }, resolve);
  });
}

// ─── Analytics / Stats ────────────────────────────────────────────────────────

/**
 * Get aggregated extension stats.
 */
export async function getStats() {
  return new Promise((resolve) => {
    chrome.storage.local.get('extensionStats', (result) => {
      resolve(result.extensionStats || {
        tabsAutoGrouped: 0,
        tabsCleanedUp: 0,
        sessionsSaved: 0
      });
    });
  });
}

/**
 * Increment a specific stat counter.
 */
export async function incrementStat(key, amount = 1) {
  const stats = await getStats();
  stats[key] = (stats[key] || 0) + amount;
  return new Promise((resolve) => {
    chrome.storage.local.set({ extensionStats: stats }, resolve);
  });
}
