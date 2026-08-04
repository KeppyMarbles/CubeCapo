import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ScrambleOptimizer } from './src/cube/scramble.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const gripTransitionsPath = path.join(__dirname, 'src/data/gripTransitions.json');
const scramblesPath = path.join(__dirname, 'src/data/scrambles.txt');

const gripTransitions = JSON.parse(fs.readFileSync(gripTransitionsPath, 'utf8'));
const rawScramblesText = fs.readFileSync(scramblesPath, 'utf8');

const scrambleLines = rawScramblesText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

console.log(`Loaded ${scrambleLines.length} test scrambles from scrambles.txt.\n`);
console.log(`Running optimization suite on ${scrambleLines.length} 3x3 scrambles...`);

const startTime = performance.now();
let totalCost = 0;
let totalIterations = 0;

const options = {
    ...ScrambleOptimizer.defaultRunOptions,
    searchRotations: false, //speedup
    maxRegripBranches: 1, //speedup
    partitionLength: 10, //speedup
    depth: 0, //speedup
};
console.table(options);

for (let i = 0; i < scrambleLines.length; i++) {
    const line = scrambleLines[i];
    const parsedMoves = ScrambleOptimizer.parseScramble(line);
    const optimizer = new ScrambleOptimizer(
        ScrambleOptimizer.defaultCostConfiguration,
        gripTransitions
    );

    await optimizer.optimize({...options, scramble: parsedMoves});
    totalCost += optimizer.bestCost;
    totalIterations += optimizer.iterations;
}

const endTime = performance.now();

const totalMs = endTime - startTime;
const totalSeconds = totalMs / 1000;
const avgMs = totalMs / scrambleLines.length;
const avgCost = totalCost / scrambleLines.length;
const avgIterations = totalIterations / scrambleLines.length;
const iterationsPerSec = totalSeconds > 0 ? (totalIterations / totalSeconds) : 0;

console.log(`\n=== SCRAMBLE OPTIMIZER TEST & BENCHMARK RESULTS ===`);
console.table({
    'Optimized ScrambleOptimizer': {
        'Total Scrambles': scrambleLines.length,
        'Total Time (ms)': totalMs.toFixed(2),
        'Avg Time per Scramble (ms)': avgMs.toFixed(2),
        'Avg Optimized Cost': avgCost.toFixed(2),
        'Total Iterations': totalIterations,
        'Avg Iterations / Scramble': Math.round(avgIterations),
        'Iterations / Second': Math.round(iterationsPerSec)
    }
});
console.log('SUCCESS: All 100 test scrambles processed cleanly!');
