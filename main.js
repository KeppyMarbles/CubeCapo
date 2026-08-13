import { setupForm, drawSearchTime, collectFormatOptionsValues } from "./shared/ui/form.js";
import { getOptionalElement } from "./shared/ui/dom.js";
import { ScrambleOptimizer } from "./shared/cube/optimizer.js";
import { drawOptimizerStats } from "./shared/ui/stats.js";
import { defaultFingertricks } from "./shared/cube/defaults.js";
/** @import { CostConfig, RunOptions, ParseResult } from "./shared/types.js" */
/** @import { Move } from "./shared/cube/move.js" */

/** @type {ScrambleOptimizer | null} */
let currentOptimizer = null;
let currentCandidateIndex = 0;
/** @type {ParseResult | null} */
let currentParseResult = null;

/**
 * Called when submit scramble button is pressed
 * @param {CostConfig} config
 * @param {ParseResult} scramble
 * @param {RunOptions} options 
 */
async function onSubmit(config, scramble, options) {
    currentCandidateIndex = 0;
    currentParseResult = scramble;
    await drawOptimizerStats(null);

    currentOptimizer = new ScrambleOptimizer(config, defaultFingertricks, async () => {
        await drawOptimizerStats(currentOptimizer, collectFormatOptionsValues(), currentCandidateIndex, currentParseResult);
    });

    const start = performance.now();
    await currentOptimizer.optimize(scramble, options);
    const end = performance.now();

    await drawOptimizerStats(currentOptimizer, collectFormatOptionsValues(), currentCandidateIndex, currentParseResult);
    drawSearchTime(end - start);
}

(async () => {
    const updateFormatLive = () => {
        if (currentOptimizer) {
            drawOptimizerStats(currentOptimizer, collectFormatOptionsValues(), currentCandidateIndex, currentParseResult);
        }
    };

    const setupPaginationControls = () => {
        const prevBtn = getOptionalElement("prevScrambleBtn", HTMLButtonElement);
        const nextBtn = getOptionalElement("nextScrambleBtn", HTMLButtonElement);

        if (prevBtn) {
            prevBtn.addEventListener("click", () => {
                if (currentOptimizer && currentCandidateIndex > 0) {
                    currentCandidateIndex--;
                    drawOptimizerStats(currentOptimizer, collectFormatOptionsValues(), currentCandidateIndex, currentParseResult);
                }
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener("click", () => {
                if (currentOptimizer && currentOptimizer.candidates && currentCandidateIndex < currentOptimizer.candidates.length - 1) {
                    currentCandidateIndex++;
                    drawOptimizerStats(currentOptimizer, collectFormatOptionsValues(), currentCandidateIndex, currentParseResult);
                }
            });
        }
    };

    setupPaginationControls();
    await setupForm(onSubmit, updateFormatLive);
})();
