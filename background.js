chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "verify-with-arbiter",
    title: "Verify claim with PageArbiter",
    contexts: ["selection"]
  });
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "verify-with-arbiter" && info.selectionText) {
    await chrome.storage.local.set({
      pendingClaim: info.selectionText,
      sourceUrl: tab.url,
      timestamp: Date.now()
    });
    chrome.sidePanel.open({ tabId: tab.id });
  }
});
