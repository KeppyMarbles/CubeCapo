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
    if (message.action === "OPTIMIZE_SCRAMBLE") {
        (async () => {
            try {
                const store = await extAPI.storage.local.get(["costConfig", "runOptions"]);
                const config = store.costConfig || ScrambleOptimizer.defaultCostConfiguration;
                
                const defaults = {
                    depth: 1,
                    maxIterations: 999999,
                    searchRotations: true,
                    pruneRotations: true,
                    memoize: true,
                    wideReplaceDouble: true
                };
                const runOptions = { ...defaults, ...store.runOptions };

                const transitions = await loadGripTransitions();
                const optimizer = new ScrambleOptimizer(config, transitions, null);
                const scramble = ScrambleOptimizer.parseScramble(message.scrambleText.trim());

                const start = performance.now();
                await optimizer.optimize({
                    scramble,
                    depth: runOptions.depth,
                    maxIterations: runOptions.maxIterations,
                    searchRotations: runOptions.searchRotations,
                    pruneRotations: runOptions.pruneRotations,
                    memoize: runOptions.memoize,
                    wideReplaceDouble: runOptions.wideReplaceDouble
                });
                const end = performance.now();

                const bestScrambleStr = optimizer.getBestAsString();
                const breakdown = optimizer.analyzeBest();
                const bestCost = optimizer.bestCost;

                sendResponse({
                    success: true,
                    bestScrambleStr,
                    breakdown,
                    bestCost,
                    searchTime: end - start
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
