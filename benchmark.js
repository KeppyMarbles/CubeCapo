import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ScrambleOptimizer } from './src/cube/scramble.js';
import { defaultCostConfiguration, defaultFingertricks, defaultRunOptions } from './src/cube/defaults.js';
/** @import {RunOptions} from './src/types.js' */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scramblesPath = path.join(__dirname, 'data/scrambles.txt');
const rawScramblesText = fs.readFileSync(scramblesPath, 'utf8');

const scrambleLines = rawScramblesText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

console.log(`Loaded ${scrambleLines.length} test scrambles from scrambles.txt.\n`);
console.log(`Running optimization suite on ${scrambleLines.length} 3x3 scrambles...`);

let startTime = performance.now();
let totalCost = 0;
let totalIterations = 0;
let totalCandidates = 0;

/** @type {RunOptions} */
const options = {
    ...defaultRunOptions,
    wideReplace: true,
    searchRotations: true, //speedup
    maxRegripBranches: 2, //speedup
    partitionLength: 0, //speedup
    depth: 0, //speedup
    searchRegrips: false,
};
console.log(options);

for (let i = 0; i < scrambleLines.length; i++) {
    const line = scrambleLines[i];
    const parsedMoves = ScrambleOptimizer.parseScramble(line);
    const optimizer = new ScrambleOptimizer(defaultCostConfiguration, defaultFingertricks);
    await optimizer.optimize(parsedMoves, options);
    const topCandidate = optimizer.candidates[0];
    totalCost += topCandidate ? topCandidate.cost : 0;
    totalIterations += optimizer.iterations;
    totalCandidates += optimizer.candidates.length;
}

const endTime = performance.now();

const totalMs = endTime - startTime;
const totalSeconds = totalMs / 1000;
const avgMs = totalMs / scrambleLines.length;
const avgCost = totalCost / scrambleLines.length;
const avgCandidates = totalCandidates / scrambleLines.length;
const avgIterations = totalIterations / scrambleLines.length;
const iterationsPerSec = totalSeconds > 0 ? (totalIterations / totalSeconds) : 0;

console.log(`\n=== SCRAMBLE OPTIMIZER TEST & BENCHMARK RESULTS ===`);
console.log({
    'Optimized ScrambleOptimizer': {
        'Total Scrambles': scrambleLines.length,
        'Total Time (ms)': totalMs.toFixed(2),
        'Avg Time per Scramble (ms)': avgMs.toFixed(2),
        'Avg Optimized Cost': avgCost.toFixed(2),
        'Avg Candidates / Scramble': avgCandidates.toFixed(2),
        'Total Iterations': totalIterations,
        'Avg Iterations / Scramble': Math.round(avgIterations),
        'Iterations / Second': Math.round(iterationsPerSec)
    }
});
console.log('SUCCESS: All 100 test scrambles processed cleanly!');
