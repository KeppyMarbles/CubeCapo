(async () => {
    await import(chrome.runtime.getURL("extension/content.js"));
})();