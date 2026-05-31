/**
 * TabMaster Pro — Session Manager
 * Save and restore named tab sessions.
 */

import { saveSession, getSessions, deleteSession, markProgrammaticTabs } from './storage.js';

/**
 * Save all current tabs in the window as a named session.
 */
export async function saveCurrentSession(name, windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const groups = await chrome.tabGroups.query({ windowId });

  const groupMap = {};
  for (const g of groups) {
    groupMap[g.id] = { title: g.title, color: g.color };
  }

  const sessionTabs = tabs.map((tab) => ({
    url: tab.url,
    title: tab.title,
    favIconUrl: tab.favIconUrl,
    pinned: tab.pinned,
    groupId: tab.groupId,
    groupTitle: tab.groupId !== -1
      ? (groupMap[tab.groupId]?.title || '')
      : null,
    groupColor: tab.groupId !== -1
      ? (groupMap[tab.groupId]?.color || 'grey')
      : null,
  }));

  const session = {
    id: `session_${Date.now()}`,
    name: name || `Session ${new Date().toLocaleString()}`,
    createdAt: Date.now(),
    tabCount: sessionTabs.length,
    tabs: sessionTabs,
  };

  await saveSession(session);
  return session;
}

/**
 * Restore a session by opening all its tabs.
 * Opens in a new window or the current window.
 */
export async function restoreSession(sessionId, inNewWindow = true) {
  const sessions = await getSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error('Session not found');

  let windowId;
  if (inNewWindow) {
    const win = await chrome.windows.create({ focused: true });
    windowId = win.id;
    // Close the default blank tab created with new window
    const blankTabs = await chrome.tabs.query({ windowId, url: 'chrome://newtab/' });
    if (blankTabs.length > 0) {
      await chrome.tabs.remove(blankTabs.map((t) => t.id));
    }
  } else {
    const currentWindow = await chrome.windows.getCurrent();
    windowId = currentWindow.id;
  }

  // Group tabs by their saved group
  const groupTitleToId = {};
  const tabsToCreate = [];

  for (const tabData of session.tabs) {
    tabsToCreate.push(tabData);
  }

  // Create all tabs first
  const createdTabs = [];
  for (const tabData of tabsToCreate) {
    const tab = await chrome.tabs.create({
      url: tabData.url,
      windowId,
      pinned: tabData.pinned,
      active: false,
    });
    createdTabs.push({ tab, tabData });
  }

  // Re-create groups
  const groupBuckets = {};
  for (const { tab, tabData } of createdTabs) {
    if (tabData.groupTitle) {
      const key = `${tabData.groupTitle}::${tabData.groupColor}`;
      if (!groupBuckets[key]) groupBuckets[key] = { tabIds: [], title: tabData.groupTitle, color: tabData.groupColor };
      groupBuckets[key].tabIds.push(tab.id);
    }
  }

  for (const { tabIds, title, color } of Object.values(groupBuckets)) {
    await markProgrammaticTabs(tabIds);
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    await chrome.tabGroups.update(groupId, { title, color });
  }

  // Focus first tab
  if (createdTabs.length > 0) {
    await chrome.tabs.update(createdTabs[0].tab.id, { active: true });
  }

  return session;
}

/**
 * Export a session as JSON string.
 */
export async function exportSession(sessionId) {
  const sessions = await getSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error('Session not found');
  return JSON.stringify(session, null, 2);
}

/**
 * Import a session from JSON string.
 */
export async function importSession(jsonString) {
  const session = JSON.parse(jsonString);
  session.id = `session_${Date.now()}`;
  session.importedAt = Date.now();
  await saveSession(session);
  return session;
}

export { getSessions, deleteSession };
