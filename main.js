import { setupForm, drawSearchTime, collectFormatOptionsValues } from "./src/ui/form.js";
import { ScrambleOptimizer } from "./src/cube/scramble.js";
import { drawOptimizerStats } from "./src/ui/stats.js";
import { defaultFingertricks } from "./src/cube/defaults.js";
/** @import { CostConfig, RunOptions } from "./src/types.js" */

/** @type {ScrambleOptimizer | null} */
let currentOptimizer = null;

/**
 * Called when submit scramble button is pressed
 * @param {CostConfig} config
 * @param {RunOptions} options 
 */
async function onSubmit(config, options) {
    await drawOptimizerStats(null);

    currentOptimizer = new ScrambleOptimizer(config, defaultFingertricks, async () => {
        await drawOptimizerStats(currentOptimizer, collectFormatOptionsValues());
    });

    const start = performance.now();
    await currentOptimizer.optimize(options);
    const end = performance.now();

    await drawOptimizerStats(currentOptimizer, collectFormatOptionsValues());
    drawSearchTime(end - start);
}

(async () => {
    const updateFormatLive = () => {
        if (currentOptimizer) {
            const formatOptions = collectFormatOptionsValues();
            document.getElementById("output").textContent = currentOptimizer.getBestAsString(formatOptions);
        }
    };

    await setupForm(onSubmit, updateFormatLive);
})();