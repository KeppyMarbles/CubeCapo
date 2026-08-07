import { setupForm, drawSearchTime, collectFormatOptionsValues } from "./shared/ui/form.js";
import { getOptionalElement } from "./shared/ui/dom.js";
import { ScrambleOptimizer } from "./shared/cube/scramble.js";
import { drawOptimizerStats } from "./shared/ui/stats.js";
import { defaultFingertricks } from "./shared/cube/defaults.js";
/** @import { CostConfig, RunOptions } from "./shared/types.js" */
/** @import { Move } from "./shared/cube/move.js" */

/** @type {ScrambleOptimizer | null} */
let currentOptimizer = null;
let currentCandidateIndex = 0;

/**
 * Called when submit scramble button is pressed
 * @param {CostConfig} config
 * @param {Move[]} scramble
 * @param {RunOptions} options 
 */
async function onSubmit(config, scramble, options) {
    currentCandidateIndex = 0;
    await drawOptimizerStats(null);

    currentOptimizer = new ScrambleOptimizer(config, defaultFingertricks, async () => {
        await drawOptimizerStats(currentOptimizer, collectFormatOptionsValues(), currentCandidateIndex);
    });

    const start = performance.now();
    await currentOptimizer.optimize(scramble, options);
    const end = performance.now();

    await drawOptimizerStats(currentOptimizer, collectFormatOptionsValues(), currentCandidateIndex);
    drawSearchTime(end - start);
}

(async () => {
    const updateFormatLive = () => {
        if (currentOptimizer) {
            drawOptimizerStats(currentOptimizer, collectFormatOptionsValues(), currentCandidateIndex);
        }
    };

    const setupPaginationControls = () => {
        const prevBtn = getOptionalElement("prevScrambleBtn", HTMLButtonElement);
        const nextBtn = getOptionalElement("nextScrambleBtn", HTMLButtonElement);

        if (prevBtn) {
            prevBtn.addEventListener("click", () => {
                if (currentOptimizer && currentCandidateIndex > 0) {
                    currentCandidateIndex--;
                    drawOptimizerStats(currentOptimizer, collectFormatOptionsValues(), currentCandidateIndex);
                }
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener("click", () => {
                if (currentOptimizer && currentOptimizer.candidates && currentCandidateIndex < currentOptimizer.candidates.length - 1) {
                    currentCandidateIndex++;
                    drawOptimizerStats(currentOptimizer, collectFormatOptionsValues(), currentCandidateIndex);
                }
            });
        }
    };

    setupPaginationControls();
    await setupForm(onSubmit, updateFormatLive);
})();
