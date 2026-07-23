import { setupForm, drawSearchTime } from "./src/ui/form.js";
import { ScrambleOptimizer } from "./src/cube/scramble.js";
import { drawOptimizerStats } from "./src/ui/stats.js";
import gripTransitions from './src/data/gripTransitions.json' with { type: 'json' };
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

    currentOptimizer = new ScrambleOptimizer(config, gripTransitions, async () => {
        await drawOptimizerStats(currentOptimizer, options);
    });

    const start = performance.now();
    await currentOptimizer.optimize(options);
    const end = performance.now();

    await drawOptimizerStats(currentOptimizer, options);
    drawSearchTime(end - start);
}

(async () => {
    await setupForm(onSubmit);

    const updateFormatLive = () => {
        if (currentOptimizer) {
            const showGrips = document.getElementById("showGrips")?.checked ?? true;
            const wedgeNotation = document.getElementById("wedgeNotation")?.checked ?? false;
            document.getElementById("output").textContent = currentOptimizer.getBestAsString({ showGrips, wedgeNotation });
        }
    };

    document.getElementById("showGrips")?.addEventListener("change", updateFormatLive);
    document.getElementById("wedgeNotation")?.addEventListener("change", updateFormatLive);
})();