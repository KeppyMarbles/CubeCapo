import { getElement } from "../shared/ui/dom.js";
import { DEFAULT_PROFILE_NAME, resolveProfile, loadProfiles, loadActiveProfileName, saveActiveProfileName, persistActiveProfile } from "../shared/profiles.js";

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

    // Switch the active settings profile
    const profileSelect = getElement("profileSelect", HTMLSelectElement);
    const profiles = await loadProfiles();
    for (const name of [DEFAULT_PROFILE_NAME, ...Object.keys(profiles)]) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        profileSelect.appendChild(option);
    }
    profileSelect.value = await loadActiveProfileName();

    profileSelect.addEventListener("change", async () => {
        const name = profileSelect.value;
        await persistActiveProfile(resolveProfile(name, profiles));
        await saveActiveProfileName(name);

        // Notify the options page / content scripts of the settings change
        const tabs = await extAPI.tabs.query({});
        for (const openTab of tabs) {
            if (!openTab.id) continue;
            extAPI.tabs.sendMessage(openTab.id, { action: "SETTINGS_CHANGED" }, () => {
                if (extAPI.runtime.lastError) { /* ignore */ }
            });
        }
    });

    // Bind quick computation & format options
    await setupOptionsBinding("scrambleOptions", {
        cubeSize: { id: "cubeSizeSelect", type: "number" }
    }, tab);

    await setupOptionsBinding("parseOptions", {
        notation: { id: "notationModeSelect", type: "string" }
    }, tab);
});

/**
 * Bind DOM inputs to chrome.storage.local options and broadcast changes
 * @param {string} storageKey - Target storage key (e.g. 'scrambleOptions', 'parseOptions')
 * @param {Record<string, { id: string, type?: string }>} bindings - Map of option property to DOM element ID
 * @param {any} [activeTab] - Active tab to notify on settings change
 */
async function setupOptionsBinding(storageKey, bindings, activeTab) {
    const store = await extAPI.storage.local.get([storageKey]);
    const currentOptions = store[storageKey] || {};

    for (const [optKey, config] of Object.entries(bindings)) {
        const el = getElement(config.id, HTMLElement);

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
            } else if ((el instanceof HTMLInputElement || el instanceof HTMLSelectElement) && config.type === "number") {
                updatedOpts[optKey] = el.value ? Number(el.value) : null;
            } else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
                updatedOpts[optKey] = el.value ? el.value : null;
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
