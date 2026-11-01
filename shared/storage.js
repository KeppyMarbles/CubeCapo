/**
 * Cross-environment storage helper (Chrome Extension chrome.storage.local with localStorage fallback).
 */

const hasChromeStorage = typeof chrome !== "undefined" && Boolean(chrome.storage?.local);

/**
 * Get a value from storage with fallback to localStorage and a default value.
 * @template T
 * @param {string} key
 * @param {T} defaultValue
 * @returns {Promise<T>}
 */
export async function getStorageItem(key, defaultValue) {
    let stored = null;

    if (hasChromeStorage) {
        try {
            const result = await chrome.storage.local.get([key]);
            if (result && key in result && result[key] !== undefined) {
                stored = result[key];
            }
        } catch {
            // Fall back to localStorage
        }
    }

    if (stored === null) {
        try {
            const raw = localStorage.getItem(key);
            if (raw !== null) {
                stored = JSON.parse(raw);
            }
        } catch {
            // Ignore parse errors and fall back to defaultValue
        }
    }

    if (stored === null || stored === undefined) {
        return defaultValue;
    }

    if (
        typeof defaultValue === "object" &&
        defaultValue !== null &&
        !Array.isArray(defaultValue) &&
        typeof stored === "object" &&
        stored !== null &&
        !Array.isArray(stored)
    ) {
        return Object.assign(structuredClone(defaultValue), stored);
    }

    return stored;
}

/**
 * Set a value in both chrome.storage.local (if present) and localStorage.
 * @param {string} key
 * @param {unknown} value
 * @returns {Promise<void>}
 */
export async function setStorageItem(key, value) {
    if (hasChromeStorage) {
        try {
            await new Promise((resolve) => {
                chrome.storage.local.set({ [key]: value }, () => resolve(undefined));
            });
        } catch {
            // Ignore storage write errors
        }
    }
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Ignore quota/private browsing errors
    }
}

/**
 * Remove a key from storage.
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function removeStorageItem(key) {
    if (hasChromeStorage) {
        try {
            await new Promise((resolve) => {
                chrome.storage.local.remove([key], () => resolve(undefined));
            });
        } catch {
            // Ignore storage remove errors
        }
    }
    try {
        localStorage.removeItem(key);
    } catch {
        // Ignore errors
    }
}

/**
 * Tell the options page and content scripts in all tabs that the stored settings changed.
 * @returns {void}
 */
export function notifySettingsChanged() {
    if (typeof chrome === "undefined" || !chrome.tabs) return;
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
            if (tab.id) {
                chrome.tabs.sendMessage(tab.id, { action: "SETTINGS_CHANGED" }, () => {
                    if (chrome.runtime.lastError) { /* ignore */ }
                });
            }
        });
    });
}
