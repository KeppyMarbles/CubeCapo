const extAPI = globalThis.browser || globalThis.chrome;

document.addEventListener("DOMContentLoaded", async () => {
    const enableToggle = document.getElementById("enableToggle");
    const hostNameEl = document.getElementById("hostName");
    const selectorStateEl = document.getElementById("selectorState");
    const pickerBtn = document.getElementById("pickerBtn");
    const clearSelectorBtn = document.getElementById("clearSelectorBtn");
    const optionsBtn = document.getElementById("optionsBtn");

    // Get the active tab details
    const [tab] = await extAPI.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
        try {
            const url = new URL(tab.url);
            const hostname = url.hostname;
            hostNameEl.textContent = hostname;

            // Load saved selector state
            const store = await extAPI.storage.local.get([`selector_${hostname}`]);
            const savedSelector = store[`selector_${hostname}`];
            if (savedSelector) {
                selectorStateEl.textContent = "Set";
                selectorStateEl.className = "status-val set";
                clearSelectorBtn.classList.remove("hidden");
            } else {
                selectorStateEl.textContent = "Not Set";
                selectorStateEl.className = "status-val not-set";
                clearSelectorBtn.classList.add("hidden");
            }

            clearSelectorBtn.addEventListener("click", async () => {
                await extAPI.storage.local.remove([`selector_${hostname}`]);
                selectorStateEl.textContent = "Not Set";
                selectorStateEl.className = "status-val not-set";
                clearSelectorBtn.classList.add("hidden");
                
                // Notify content script
                extAPI.tabs.sendMessage(tab.id, { action: "SETTINGS_CHANGED" }, () => {
                    if (extAPI.runtime.lastError) console.log(extAPI.runtime.lastError.message);
                });
            });
        } catch (e) {
            hostNameEl.textContent = "Unsupported page";
            pickerBtn.disabled = true;
        }
    } else {
        hostNameEl.textContent = "No page loaded";
        pickerBtn.disabled = true;
    }

    // Toggle enabled state
    const store = await extAPI.storage.local.get(["enabled"]);
    enableToggle.checked = store.enabled !== false;

    enableToggle.addEventListener("change", async () => {
        const enabled = enableToggle.checked;
        await extAPI.storage.local.set({ enabled });
        
        // Notify tab to update
        if (tab) {
            extAPI.tabs.sendMessage(tab.id, { action: "STATE_CHANGED" }, () => {
                if (extAPI.runtime.lastError) console.log(extAPI.runtime.lastError.message);
            });
        }
    });

    // Start picker
    pickerBtn.addEventListener("click", () => {
        if (tab) {
            extAPI.tabs.sendMessage(tab.id, { action: "START_PICKER" }, (response) => {
                if (extAPI.runtime.lastError) {
                    alert("Could not start picker. Try refreshing the page.");
                } else {
                    window.close(); // Close popup when picking starts
                }
            });
        }
    });

    // Open options page
    optionsBtn.addEventListener("click", () => {
        extAPI.runtime.openOptionsPage();
    });
});
