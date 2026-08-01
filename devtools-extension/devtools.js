/**
 * Creates the "ASG Offline" tab in Chrome DevTools Panel
 */
chrome.devtools.panels.create(
  "📡 ASG Offline",
  "",
  "panel.html",
  function (panel) {
    console.log('[ASG Offline Extension] DevTools panel created successfully.');
  }
);
