import { ScrambleOptimizer } from "../src/cube/scramble.js";
import { defaultCostConfiguration, defaultFormatOptions, defaultFingertricks, defaultRunOptions } from "../src/cube/defaults.js";
/** @import { SendOptimizationResponse } from "../src/types.js" */

const extAPI = /** @type {any} */ (globalThis).browser || chrome;

// Listen for messages from content scripts or popup
extAPI.runtime.onMessage.addListener(
    /**
     * @param {any} message
     * @param {any} sender
     * @param {SendOptimizationResponse} sendResponse
     */
    (message, sender, sendResponse) => {
    if (message.action === "OPEN_OPTIONS_PAGE") {
        (async () => {
            if (message.scrambleText) {
                await extAPI.storage.local.set({ pendingScramble: message.scrambleText });
            }
            if (extAPI.runtime.openOptionsPage) {
                extAPI.runtime.openOptionsPage();
            }
            if (message.scrambleText && extAPI.tabs) {
                extAPI.tabs.query({}, (/** @type {chrome.tabs.Tab[]} */ tabs) => {
                    tabs.forEach((/** @type {chrome.tabs.Tab} */ tab) => {
                        if (tab.id) {
                            extAPI.tabs.sendMessage(tab.id, {
                                action: "LOAD_PENDING_SCRAMBLE",
                                scrambleText: message.scrambleText
                            }, () => {
                                if (extAPI.runtime.lastError) { /* ignore */ }
                            });
                        }
                    });
                });
            }
            sendResponse({ success: true });
        })();
        return true;
    }

    if (message.action === "OPTIMIZE_SCRAMBLE") {
        (async () => {
            try {
                const rawText = (message.scrambleText || "").trim();
                if (!rawText) {
                    sendResponse({ success: false, error: "Empty scramble text" });
                    return;
                }

                // Validate scramble move syntax
                let scramble;
                try {
                    scramble = ScrambleOptimizer.parseScramble(rawText);
                    if (!scramble || scramble.length === 0) {
                        sendResponse({ success: false, error: "Invalid scramble text" });
                        return;
                    }
                } catch (parseErr) {
                    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
                    sendResponse({ success: false, error: msg });
                    return;
                }

                const store = await extAPI.storage.local.get(["costConfig", "runOptions", "formatOptions"]);
                const config = store.costConfig || defaultCostConfiguration;

                const cubeSize = Number(store.runOptions?.cubeSize ?? 0);

                const runOptions = { ...defaultRunOptions, ...store.runOptions, cubeSize };
                const formatOptions = { ...defaultFormatOptions, ...store.formatOptions };

                const optimizer = new ScrambleOptimizer(config, defaultFingertricks, null);

                const start = performance.now();
                await optimizer.optimize(scramble, runOptions);
                const end = performance.now();

                const topCandidate = optimizer.candidates[0];
                const bestScrambleStr = topCandidate ? optimizer.formatCandidate(topCandidate, formatOptions) : "";
                const breakdown = topCandidate ? optimizer.analyzeCandidate(topCandidate, formatOptions) : [];
                const bestCost = topCandidate ? topCandidate.cost : Infinity;

                sendResponse({
                    success: true,
                    bestScrambleStr,
                    breakdown,
                    bestCost,
                    searchTime: end - start,
                    cubeSize: optimizer.options.cubeSize // TODO?
                });
            } catch (error) {
                console.error("Optimization background task error:", error);
                const msg = error instanceof Error ? error.message : String(error);
                sendResponse({
                    success: false,
                    error: msg
                });
            }
        })();
        return true; // Keep connection open for asynchronous sendResponse
    }
});
