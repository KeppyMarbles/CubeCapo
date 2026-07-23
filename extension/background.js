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
                // 1. Get configurations from storage
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

                // 2. Ensure transitions are loaded
                const transitions = await loadGripTransitions();

                // 3. Initialize optimizer
                const optimizer = new ScrambleOptimizer(config, transitions, null);

                // 4. Parse the scramble
                const scramble = ScrambleOptimizer.parseScramble(message.scrambleText.trim());

                // 5. Optimize
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

                // 6. Fetch optimized data
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
