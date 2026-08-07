import { getElement, getOptionalElement } from "../src/ui/dom.js";

const extAPI = /** @type {any} */ (globalThis).browser || globalThis.chrome;

document.addEventListener("DOMContentLoaded", async () => {
    const enableToggle = getElement("enableToggle", HTMLInputElement);
    const hostNameEl = getElement("hostName", HTMLElement);
    const selectorStateEl = getElement("selectorState", HTMLElement);
    const pickerBtn = getElement("pickerBtn", HTMLButtonElement);
    const clearSelectorBtn = getElement("clearSelectorBtn", HTMLButtonElement);
    const optionsBtn = getElement("optionsBtn", HTMLButtonElement);

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
                if (tab.id) {
                    extAPI.tabs.sendMessage(tab.id, { action: "SETTINGS_CHANGED" }, () => {
                        if (extAPI.runtime.lastError) console.log(extAPI.runtime.lastError.message);
                    });
                }
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
        if (tab?.id) {
            extAPI.tabs.sendMessage(tab.id, { action: "STATE_CHANGED" }, () => {
                if (extAPI.runtime.lastError) console.log(extAPI.runtime.lastError.message);
            });
        }
    });

    // Start picker
    pickerBtn.addEventListener("click", () => {
        if (tab?.id) {
            extAPI.tabs.sendMessage(tab.id, { action: "START_PICKER" }, (/** @type {any} */ response) => {
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

    // Bind quick computation & format options
    await setupOptionsBinding("runOptions", {
        cubeSize: { id: "cubeSizeSelect", type: "number" }
    }, tab);
});

/**
 * Bind DOM inputs to chrome.storage.local options and broadcast changes
 * @param {string} storageKey - Target storage key (e.g. 'runOptions', 'formatOptions')
 * @param {Record<string, { id: string, type?: string }>} bindings - Map of option property to DOM element ID
 * @param {any} [activeTab] - Active tab to notify on settings change
 */
async function setupOptionsBinding(storageKey, bindings, activeTab) {
    const store = await extAPI.storage.local.get([storageKey]);
    const currentOptions = store[storageKey] || {};

    for (const [optKey, config] of Object.entries(bindings)) {
        const el = getOptionalElement(config.id, HTMLElement);
        if (!el) continue;

        const val = currentOptions[optKey];
        if (el instanceof HTMLInputElement && el.type === "checkbox") {
            el.checked = Boolean(val);
        } else if (val !== undefined && val !== null && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) {
            el.value = String(val);
        }

        el.addEventListener("change", async () => {
            const freshStore = await extAPI.storage.local.get([storageKey]);
            const updatedOpts = { ...(freshStore[storageKey] || {}) };

            if (el instanceof HTMLInputElement && el.type === "checkbox") {
                updatedOpts[optKey] = el.checked;
            } else if ((el instanceof HTMLInputElement || el instanceof HTMLSelectElement) && (config.type === "number" || el.tagName === "SELECT")) {
                updatedOpts[optKey] = Number(el.value);
            } else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
                updatedOpts[optKey] = el.value;
            }

            await extAPI.storage.local.set({ [storageKey]: updatedOpts });

            if (activeTab?.id) {
                extAPI.tabs.sendMessage(activeTab.id, { action: "SETTINGS_CHANGED" }, () => {
                    if (extAPI.runtime.lastError) { /* ignore */ }
                });
            }
        });
    }
}
