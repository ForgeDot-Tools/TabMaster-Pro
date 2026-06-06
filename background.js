/**
 * ForgeTabs — Background Service Worker
 * Handles tab events, alarms, context menus, and auto-grouping.
 */

import { getSettings, updateTabActivity, pruneTabActivity, popProgrammaticTab, markTabAsManuallyGrouped, forgetManuallyGroupedTab } from './utils/storage.js';
import { autoGroupByDomain, getDomain, collapseAllExceptActive } from './utils/tabManager.js';
import { saveCurrentSession } from './utils/sessionManager.js';

// ─── Context Menus ───────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  // Create context menu items
  chrome.contextMenus.create({
    id: 'tabmaster-group-all',
    title: 'TabMaster: Group all tabs by domain',
    contexts: ['action'],
  });
  chrome.contextMenus.create({
    id: 'tabmaster-save-session',
    title: 'TabMaster: Save current session',
    contexts: ['action'],
  });
  chrome.contextMenus.create({
    id: 'tabmaster-settings',
    title: 'TabMaster: Open settings',
    contexts: ['action'],
  });

  // Set up recurring alarm for stale-tab checks
  chrome.alarms.create('tabmaster-stale-check', { periodInMinutes: 60 });
  chrome.alarms.create('tabmaster-activity-prune', { periodInMinutes: 30 });

  console.log('[ForgeTabs] Installed & initialized.');
});

// ─── Context Menu Handler ────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const windowId = tab?.windowId || chrome.windows.WINDOW_ID_CURRENT;
  switch (info.menuItemId) {
    case 'tabmaster-group-all':
      await autoGroupByDomain(windowId, true);
      break;
    case 'tabmaster-save-session':
      await saveCurrentSession(`Auto-save ${new Date().toLocaleString()}`, windowId);
      showNotification('Session Saved', 'Your current tabs have been saved as a session.');
      break;
    case 'tabmaster-settings':
      chrome.runtime.openOptionsPage();
      break;
  }
});

// ─── Tab Activity Tracking ───────────────────────────────────────────────────

// Cooldown timestamp so the tab-limit notification fires at most once per minute
let tabLimitLastWarnAt = 0;

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await updateTabActivity(tabId);

  // Check tab limit warning — only count UNGROUPED tabs.
  // Tabs already in a group are organized; including them creates false alarms.
  const settings = await getSettings();
  if (settings.notificationsEnabled && settings.tabLimitWarning) {
    const win = await chrome.windows.getLastFocused({ populate: true });
    if (win?.tabs) {
      const ungrouped = win.tabs.filter((t) => t.groupId === -1 && !t.pinned);
      if (ungrouped.length >= settings.tabLimitWarning) {
        // Cooldown: don't fire more than once per minute to avoid spam on rapid switching
        const now = Date.now();
        const lastWarn = tabLimitLastWarnAt;
        if (now - lastWarn >= 60_000) {
          tabLimitLastWarnAt = now;
          showNotification(
            '⚠️ Tab Limit Reached',
            `You have ${ungrouped.length} ungrouped tabs open (${win.tabs.length} total). Consider grouping or cleaning up!`
          );
        }
      }
    }
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    await updateTabActivity(tabId);

    // Auto-group if setting enabled
    const settings = await getSettings();
    if (settings.autoGroup) {
      const tab = await chrome.tabs.get(tabId);
      const domain = getDomain(tab.url);
      if (domain && !settings.excludedDomains?.includes(domain)) {
        // Only trigger if this tab isn't already in a group (newly opened)
        if (tab.groupId === -1) {
          setTimeout(async () => {
            await autoGroupByDomain(tab.windowId, false);
            // Keep the user's current group expanded — collapse everything else
            await collapseAllExceptActive(tab.windowId);
          }, 1500);
        }
      }
    }
  }
});

// Track manual tab grouping changes (e.g. dragging a tab)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if ('groupId' in changeInfo) {
    const isProgrammatic = await popProgrammaticTab(tabId);
    if (!isProgrammatic) {
      // User manually changed the group (dragged tab in/out)!
      await markTabAsManuallyGrouped(tabId);
    }
  }
});

// Clean up manual grouping overrides when tabs are closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await forgetManuallyGroupedTab(tabId);
});

// ─── Alarm Handler ───────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'tabmaster-activity-prune') {
    await pruneTabActivity();
  }

  if (alarm.name === 'tabmaster-stale-check') {
    const settings = await getSettings();
    if (settings.notificationsEnabled && settings.inactiveDays) {
      const cutoff = Date.now() - settings.inactiveDays * 24 * 60 * 60 * 1000;
      const { tabActivity } = await new Promise((r) =>
        chrome.storage.local.get('tabActivity', r)
      );
      if (!tabActivity) return;

      const tabs = await chrome.tabs.query({ active: false, pinned: false });
      let staleCount = 0;
      for (const tab of tabs) {
        const lastActive = tabActivity[tab.id] || tab.lastAccessed || 0;
        if (lastActive < cutoff) staleCount++;
      }
      if (staleCount > 0) {
        showNotification(
          '🗂️ Stale Tabs Detected',
          `You have ${staleCount} tab(s) inactive for ${settings.inactiveDays}+ days. Open ForgeTabs to clean up.`
        );
      }
    }
  }
});

// ─── Message Handler (from popup/settings) ───────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ error: err.message });
  });
  return true; // keep channel open for async
});

async function handleMessage(message) {
  const { action, payload } = message;
  switch (action) {
    case 'auto-group': {
      const win = await chrome.windows.getLastFocused();
      const results = await autoGroupByDomain(win?.id);
      return { success: true, groups: results };
    }
    case 'get-stats': {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const groups = await chrome.tabGroups.query({ windowId: tabs[0]?.windowId });
      return { tabCount: tabs.length, groupCount: groups.length };
    }
    default:
      return { error: 'Unknown action' };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: '/icons/icon48.png',
    title,
    message,
    priority: 1,
  });
}
