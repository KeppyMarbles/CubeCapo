import { ScrambleOptimizer } from "../src/cube/scramble.js";
import { Move } from "../src/cube/move.js";

const extAPI = globalThis.browser || globalThis.chrome;

let gripTransitions = null;

/**
 * Load grip transitions from the JSON file packaged with the extension.
 */
async function loadGripTransitions() {
    if (gripTransitions) return gripTransitions;
    const url = extAPI.runtime.getURL("src/data/gripTransitions.json");
    const response = await fetch(url);
    gripTransitions = await response.json();
    return gripTransitions;
}

// Listen for messages from content scripts or popup
extAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "OPEN_OPTIONS_PAGE") {
        (async () => {
            if (message.scrambleText) {
                await extAPI.storage.local.set({ pendingScramble: message.scrambleText });
            }
            if (extAPI.runtime.openOptionsPage) {
                extAPI.runtime.openOptionsPage();
            }
            if (message.scrambleText && extAPI.tabs) {
                extAPI.tabs.query({}, (tabs) => {
                    tabs.forEach(tab => {
                        extAPI.tabs.sendMessage(tab.id, {
                            action: "LOAD_PENDING_SCRAMBLE",
                            scrambleText: message.scrambleText
                        }, () => {
                            if (extAPI.runtime.lastError) { /* ignore */ }
                        });
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
                    sendResponse({ success: false, error: parseErr.message });
                    return;
                }

                // Validate supported cube size (currently 3x3)
                const cubeSize = ScrambleOptimizer.detectCubeSize(scramble);
                const supportedSizes = [3];
                if (!supportedSizes.includes(cubeSize)) {
                    sendResponse({ success: false, error: `${cubeSize}x${cubeSize} scrambles are not supported yet` });
                    return;
                }

                const store = await extAPI.storage.local.get(["costConfig", "runOptions"]);
                const config = store.costConfig || ScrambleOptimizer.defaultCostConfiguration;
                
                const runOptions = { ...ScrambleOptimizer.defaultRunOptions, ...store.runOptions, scramble };

                const transitions = await loadGripTransitions();
                const optimizer = new ScrambleOptimizer(config, transitions, null);

                const start = performance.now();
                await optimizer.optimize(runOptions);
                const end = performance.now();

                const bestScrambleStr = optimizer.getBestAsString(runOptions);
                const breakdown = optimizer.analyzeBest(runOptions);
                const bestCost = optimizer.bestCost;

                sendResponse({
                    success: true,
                    bestScrambleStr,
                    breakdown,
                    bestCost,
                    searchTime: end - start,
                    cubeSize
                });
            } catch (error) {
                console.error("Optimization background task error:", error);
                sendResponse({
                    success: false,
                    error: error.message
                });
            }
        })();
        return true; // Keep connection open for asynchronous sendResponse
    }
});
