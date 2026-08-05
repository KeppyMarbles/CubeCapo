/** @import { OptimizationResult } from "../src/types.js" */

const extAPI = globalThis.browser || globalThis.chrome;

let currentObserver = null;
let scrambleObserver = null;
let targetElement = null;
let lastOriginalText = "";
let isShowingOptimized = true;
let pickerActive = false;
let hoverElement = null;
let pickerBanner = null;

/**
 * Generates a unique CSS selector string for an element.
 * @param {Element} el - Target DOM element.
 * @returns {string} Unique CSS selector string.
 */
function getUniqueSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return "";
    if (el === document.body) return "body";
    if (el.id) {
        // Escape special characters in ID for CSS selector query matching
        return `#${CSS.escape(el.id)}`;
    }
    const path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE && el !== document.body) {
        let selector = el.nodeName.toLowerCase();
        if (el.id) {
            selector += `#${CSS.escape(el.id)}`;
            path.unshift(selector);
            break;
        } else {
            let sibling = el;
            let nth = 1;
            while (sibling = sibling.previousElementSibling) {
                if (sibling.nodeName.toLowerCase() === el.nodeName.toLowerCase()) {
                    nth++;
                }
            }
            if (nth > 1 || el.nextElementSibling) {
                selector += `:nth-of-type(${nth})`;
            }
        }
        path.unshift(selector);
        el = el.parentElement;
    }
    return path.join(" > ");
}

/**
 * Finds the scramble DOM element saved by user for the current hostname.
 * @returns {Promise<Element|null>} Target scramble element or null if not found.
 */
async function findScrambleElement() {
    // Only check for user-selected custom selector for this hostname
    const store = await extAPI.storage.local.get([`selector_${location.hostname}`]);
    const savedSelector = store[`selector_${location.hostname}`];
    if (savedSelector) {
        try {
            const el = document.querySelector(savedSelector);
            if (el) {
                console.log(`[Cube Capo] Found element using saved selector '${savedSelector}'`);
                return el;
            } else {
                console.warn(`[Cube Capo] Saved selector '${savedSelector}' yielded no element in DOM.`);
            }
        } catch (err) {
            console.error(`[Cube Capo] Invalid saved selector '${savedSelector}':`, err);
        }
    } else {
        console.log(`[Cube Capo] No saved selector for host '${location.hostname}'.`);
    }
    return null;
}

/**
 * Safe utility to modify scramble element text content in place.
 * Disconnects the observer during mutation to prevent mutation loops.
 * @param {Element} element - Target scramble DOM element.
 * @param {string} text - New text content.
 * @returns {Promise<void>}
 */
async function updateScrambleText(element, text) {
    if (scrambleObserver) {
        scrambleObserver.disconnect();
    }
    element.textContent = text;
    if (scrambleObserver) {
        scrambleObserver.observe(element, {
            characterData: true,
            childList: true,
            subtree: true
        });
    }
}

let lastOptimizedText = "";

/**
 * Triggers background optimization for a scramble element and manages UI state.
 * @param {Element} element - Target scramble DOM element.
 * @returns {Promise<void>}
 */
async function processScramble(element) {
    // Clone node or extract text excluding our own injected visual overlay span
    let rawText = "";
    for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            rawText += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList.contains("cubecapo-hidden-text")) {
                rawText += node.textContent;
            } else if (!node.classList.contains("cubecapo-visual-overlay")) {
                rawText += node.textContent;
            }
        }
    }
    const text = rawText.trim();
    if (!text) return;
    
    // Ignore if this text is equal to lastOriginalText
    if (text === lastOriginalText) return;

    lastOriginalText = text;
    lastOptimizedText = "";
    isShowingOptimized = true;

    showOptimizingState(element);

    // Send to background optimizer worker
    extAPI.runtime.sendMessage(
        {
            action: "OPTIMIZE_SCRAMBLE",
            scrambleText: text
        },
        /**
         * @param {OptimizationResult} response
         */
        async (response) => {
            if (extAPI.runtime.lastError) {
                console.warn("[Cube Capo] Chrome extension message error:", extAPI.runtime.lastError);
                hideIndicator();
                return;
            }
            if (response && response.success) {
                console.log("[Cube Capo] Optimization success:", response.bestScrambleStr);
                lastOptimizedText = response.bestScrambleStr;
                showOptimizedState(element, response);
            } else {
                console.log("[Cube Capo] Scramble ignored or not supported:", response ? response.error : "No response");
                hideIndicator();
            }
        }
    );
}

/**
 * Generates HSL background color style based on movement cost intensity.
 * @param {number} cost - Numerical move cost.
 * @returns {string} CSS inline style string.
 */
function costToColorStyle(cost) {
    const ratio = Math.max(-1, Math.min(1, (cost - 2) / 5));
    const hue = 60 - ratio * 60;
    return `background-color: hsl(${hue}, 100%, 85%); color: #0f172a;`;
}

/**
 * Hides original text nodes immediately while preserving element layout and structure.
 * @param {Element} scrambleElement - Target scramble DOM element.
 */
function hideOriginalText(scrambleElement) {
    for (const child of Array.from(scrambleElement.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
            const hideSpan = document.createElement("span");
            hideSpan.className = "cubecapo-hidden-text";
            hideSpan.style.display = "none";
            hideSpan.textContent = child.textContent;
            scrambleElement.replaceChild(hideSpan, child);
        } else if (child.nodeType === Node.ELEMENT_NODE && !child.classList.contains("cubecapo-visual-overlay")) {
            child.style.display = "none";
        }
    }
}

/**
 * Sets up optimizing state UI displaying 'Transposing...' inside the scramble text area.
 * @param {Element} scrambleElement - Target scramble DOM element.
 */
function showOptimizingState(scrambleElement) {
    hideIndicator();
    hideOriginalText(scrambleElement);

    let visualSpan = scrambleElement.querySelector(".cubecapo-visual-overlay");
    if (!visualSpan) {
        visualSpan = document.createElement("span");
        visualSpan.className = "cubecapo-visual-overlay";
        scrambleElement.appendChild(visualSpan);
    }
    visualSpan.textContent = "Transposing...";
}

/**
 * Renders the optimized scramble badge indicator, visual overlay, and details popup table card.
 * @param {Element} scrambleElement - Target scramble DOM element.
 * @param {OptimizationResult} data - Optimization result payload from background service worker.
 */
function showOptimizedState(scrambleElement, data) {
    // 1. Hide original text nodes immediately
    hideOriginalText(scrambleElement);
    
    let visualSpan = scrambleElement.querySelector(".cubecapo-visual-overlay");
    if (!visualSpan) {
        visualSpan = document.createElement("span");
        visualSpan.className = "cubecapo-visual-overlay";
        scrambleElement.appendChild(visualSpan);
    }
    visualSpan.textContent = data.bestScrambleStr;

    // 2. Ensure indicator bar exists above the element
    let bar = document.getElementById("cubecapo-indicator");
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "cubecapo-indicator";
        bar.className = "cubecapo-indicator-bar";
        scrambleElement.parentNode.insertBefore(bar, scrambleElement);
    }

    // Stop propagation on clicks inside the indicator bar
    bar.addEventListener("click", (e) => e.stopPropagation());

    bar.replaceChildren();

    const cubeSize = data.cubeSize || 3;
    const sizeStr = `${cubeSize}x${cubeSize}`;
    const transposedBadgeText = `(Transposed | Cost: ${data.bestCost.toFixed(1)} | Size: ${sizeStr})`;
    const originalBadgeText = "(Original)";

    const badge = document.createElement("span");
    badge.className = "cubecapo-badge";
    badge.textContent = isShowingOptimized ? transposedBadgeText : originalBadgeText;

    const toggleOriginalBtn = document.createElement("button");
    toggleOriginalBtn.type = "button";
    toggleOriginalBtn.id = "cubecapo-toggle-original";
    toggleOriginalBtn.className = "cubecapo-details-link";
    toggleOriginalBtn.textContent = isShowingOptimized ? "Show Original" : "Show Transposed";

    const toggleDetailsBtn = document.createElement("button");
    toggleDetailsBtn.type = "button";
    toggleDetailsBtn.id = "cubecapo-toggle-details";
    toggleDetailsBtn.className = "cubecapo-details-link";
    toggleDetailsBtn.textContent = "Details";

    const openSettingsBtn = document.createElement("button");
    openSettingsBtn.type = "button";
    openSettingsBtn.id = "cubecapo-open-settings";
    openSettingsBtn.className = "cubecapo-details-link";
    openSettingsBtn.textContent = "Settings";

    openSettingsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        extAPI.runtime.sendMessage({ 
            action: "OPEN_OPTIONS_PAGE",
            scrambleText: lastOriginalText
        });
    });

    bar.appendChild(badge);
    bar.appendChild(toggleOriginalBtn);
    bar.appendChild(toggleDetailsBtn);
    bar.appendChild(openSettingsBtn);

    // 3. Setup details table card (as a floating popup appended to body to prevent clipping)
    let details = document.getElementById("cubecapo-details-card");
    if (details) {
        details.remove();
    }

    details = document.createElement("div");
    details.id = "cubecapo-details-card";
    details.className = "cubecapo-details-card";

    // Stop propagation so clicking inside the details card doesn't copy text or trigger csTimer start/stop
    details.addEventListener("click", (e) => e.stopPropagation());

    const table = document.createElement("table");
    table.className = "cubecapo-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const headers = [
        { text: "Move", alignRight: false },
        { text: "Grip", alignRight: false },
        { text: "Fingertrick", alignRight: false },
        { text: "Cost", alignRight: true }
    ];

    for (const h of headers) {
        const th = document.createElement("th");
        th.textContent = h.text;
        if (h.alignRight) {
            th.className = "cubecapo-right";
        }
        headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);

    const tbody = document.createElement("tbody");
    if (typeof renderBreakdownTable === "function") {
        renderBreakdownTable(tbody, data.breakdown, costToColorStyle);
    }

    table.appendChild(thead);
    table.appendChild(tbody);
    details.appendChild(table);

    // Append to body so z-index floating positions correctly without parent page layout overflow cutting it off
    document.body.appendChild(details);

    // Bind original vs optimized toggle button
    const toggleTextBtn = document.getElementById("cubecapo-toggle-original");
    if (toggleTextBtn) {
        toggleTextBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            isShowingOptimized = !isShowingOptimized;
            if (isShowingOptimized) {
                visualSpan.textContent = data.bestScrambleStr;
                toggleTextBtn.textContent = "Show Original";
                badge.textContent = transposedBadgeText;
            } else {
                visualSpan.textContent = lastOriginalText;
                toggleTextBtn.textContent = "Show Transposed";
                badge.textContent = originalBadgeText;
            }
        });
    }

    // Bind details toggle button click event
    const toggleBtn = document.getElementById("cubecapo-toggle-details");
    if (toggleBtn) {
        toggleBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const isActive = details.classList.toggle("active");
            toggleBtn.textContent = isActive ? "Close" : "Details";

            if (isActive) {
                // Dynamically position the details popup card relative to the details button and viewport boundaries
                const rect = toggleBtn.getBoundingClientRect();
                details.style.position = "fixed";

                const spaceBelow = window.innerHeight - rect.bottom - 16;
                const spaceAbove = rect.top - 16;

                if (spaceBelow < 200 && spaceAbove > spaceBelow) {
                    // Position above button if bottom viewport space is constrained
                    details.style.top = "auto";
                    details.style.bottom = `${window.innerHeight - rect.top + 8}px`;
                    details.style.maxHeight = `${Math.min(spaceAbove, window.innerHeight - 32)}px`;
                } else {
                    // Position below button
                    details.style.top = `${rect.bottom + 8}px`;
                    details.style.bottom = "auto";
                    details.style.maxHeight = `${Math.max(120, spaceBelow)}px`;
                }

                // Handle horizontal boundary alignments so it does not overflow the right margin of the browser window
                const cardWidth = 380;
                if (rect.left + cardWidth > window.innerWidth) {
                    details.style.left = "auto";
                    details.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
                } else {
                    details.style.left = `${Math.max(8, rect.left)}px`;
                    details.style.right = "auto";
                }

                // Add close on click outside event handler
                const clickOutside = (event) => {
                    // Do not close if clicking inside the details popup itself or clicking the details button again
                    if (!details.contains(event.target) && event.target !== toggleBtn) {
                        details.classList.remove("active");
                        toggleBtn.textContent = "Details";
                        document.removeEventListener("click", clickOutside, true);
                    }
                };
                // Defer attaching so this click trigger itself doesn't close it instantly
                setTimeout(() => {
                    document.addEventListener("click", clickOutside, true);
                }, 10);
            }
        });
    }
}

/**
 * Removes injected indicator elements, floating details cards, and restores original text nodes.
 */
function hideIndicator() {
    if (targetElement) {
        const visualSpan = targetElement.querySelector(".cubecapo-visual-overlay");
        if (visualSpan) visualSpan.remove();

        for (const child of Array.from(targetElement.childNodes)) {
            if (child.nodeType === Node.ELEMENT_NODE && child.classList.contains("cubecapo-hidden-text")) {
                const textNode = document.createTextNode(child.textContent);
                targetElement.replaceChild(textNode, child);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                child.style.opacity = "";
                child.style.userSelect = "";
            }
        }
    }

    const bar = document.getElementById("cubecapo-indicator");
    if (bar) bar.remove();

    const details = document.getElementById("cubecapo-details-card");
    if (details) details.remove();
}

/**
 * Initializes scramble monitoring on the saved element and attaches a MutationObserver.
 * @returns {Promise<void>}
 */
async function startMonitoring() {
    const store = await extAPI.storage.local.get(["enabled"]);
    if (store.enabled === false) {
        hideIndicator();
        stopMonitoring();
        return;
    }

    // Check if existing target element was removed from document DOM tree
    if (targetElement && !document.body.contains(targetElement)) {
        console.log("[Cube Capo] Target element was detached from DOM. Re-querying selector...");
        stopMonitoring();
    }

    targetElement = await findScrambleElement();
    if (targetElement) {
        console.log("[Cube Capo] Target scramble element found/connected:", targetElement);
        // Observe text changes directly on scramble element
        if (scrambleObserver) scrambleObserver.disconnect();
        
        scrambleObserver = new MutationObserver(() => {
            processScramble(targetElement);
        });
        
        scrambleObserver.observe(targetElement, {
            characterData: true,
            childList: true,
            subtree: true
        });

        // Run immediately
        processScramble(targetElement);
    } else {
        console.log("[Cube Capo] Target scramble element not found in DOM.");
    }
}

/**
 * Stops monitoring and resets observer and state tracking variables.
 */
function stopMonitoring() {
    if (scrambleObserver) {
        scrambleObserver.disconnect();
        scrambleObserver = null;
    }
    lastOriginalText = "";
    lastOptimizedText = "";
    targetElement = null;
}

/**
 * Handles page-wide observer to reconnect target element when DOM elements are added or replaced.
 */
function initPageObserver() {
    if (currentObserver) currentObserver.disconnect();
    
    currentObserver = new MutationObserver(async (mutations) => {
        // If targetElement is missing or detached from DOM tree, re-run startMonitoring to reconnect
        if (!targetElement || !document.body.contains(targetElement)) {
            startMonitoring();
        }
    });

    // Only observe DOM node structure additions/removals across body
    currentObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
}

/**
 * Launches interactive visual element picker for custom scramble element selection.
 */
function startPicker() {
    if (pickerActive) return;
    pickerActive = true;

    // Create selection cover/overlay message banner
    const overlay = document.createElement("div");
    overlay.className = "cubecapo-picker-overlay";
    
    pickerBanner = document.createElement("div");
    pickerBanner.className = "cubecapo-picker-banner";
    pickerBanner.textContent = "Click on the Rubik's cube scramble element (Press ESC to cancel)";
    overlay.appendChild(pickerBanner);
    document.body.appendChild(overlay);

    const onMouseOver = (e) => {
        e.stopPropagation();
        if (hoverElement) {
            hoverElement.classList.remove("cubecapo-picker-hover");
        }
        hoverElement = e.target;
        // Avoid highlighting our own picker overlay
        if (hoverElement && !overlay.contains(hoverElement)) {
            hoverElement.classList.add("cubecapo-picker-hover");
        }
    };

    const onClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (hoverElement && !overlay.contains(hoverElement)) {
            const selector = getUniqueSelector(hoverElement);
            extAPI.storage.local.set({ [`selector_${location.hostname}`]: selector }, () => {
                console.log(`Saved selector for ${location.hostname}: ${selector}`);
                cleanupPicker();
                // Restart monitoring with new selector
                stopMonitoring();
                startMonitoring();
            });
        }
    };

    const onKeyDown = (e) => {
        if (e.key === "Escape") {
            cleanupPicker();
        }
    };

    const cleanupPicker = () => {
        pickerActive = false;
        overlay.remove();
        if (hoverElement) {
            hoverElement.classList.remove("cubecapo-picker-hover");
            hoverElement = null;
        }
        document.removeEventListener("mouseover", onMouseOver, true);
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("keydown", onKeyDown, true);
    };

    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
}

// Message listener from popup/settings
extAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "START_PICKER") {
        startPicker();
        sendResponse({ success: true });
    } else if (message.action === "SETTINGS_CHANGED") {
        stopMonitoring();
        startMonitoring();
        sendResponse({ success: true });
    } else if (message.action === "STATE_CHANGED") {
        startMonitoring();
        sendResponse({ success: true });
    }
});

// Run at startup
(async () => {
    const store = await extAPI.storage.local.get(["enabled"]);
    // Default to enabled if not set
    if (store.enabled === undefined) {
        await extAPI.storage.local.set({ enabled: true });
    }
    startMonitoring();
    initPageObserver();
})();
