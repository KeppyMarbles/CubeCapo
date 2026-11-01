import { getElement, queryElementOptional } from "./dom.js";
/** @import { ScrambleBreakdownEntry, OrientationResultInfo, FormatOptions, ScrambleOptimizer } from "../cube/optimizer.js" */
/** @import { ParseResult } from "../cube/parser.js" */

/**
 * Show all the results of the scramble optimizer
 * @param {ScrambleOptimizer | null} optimizer 
 * @param {FormatOptions} [formatOptions]
 * @param {number} [candidateIndex]
 * @param {ParseResult | null} [parseResult]
 */
export async function drawOptimizerStats(optimizer, formatOptions, candidateIndex = 0, parseResult = null) {
    const metaContainer = getElement("scrambleMeta", HTMLDivElement);
    const metaText = getElement("scrambleMetaText", HTMLElement);
    const paginationContainer = getElement("scramblePagination", HTMLDivElement);
    const indicator = getElement("scramblePageIndicator", HTMLElement);
    const prevBtn = getElement("prevScrambleBtn", HTMLButtonElement);
    const nextBtn = getElement("nextScrambleBtn", HTMLButtonElement);
    const outputEl = getElement("output", HTMLElement);

    if (optimizer && optimizer.candidates && optimizer.candidates.length > 0) {
        const total = optimizer.candidates.length;
        const validIndex = Math.max(0, Math.min(candidateIndex, total - 1));
        const candidate = optimizer.candidates[validIndex];

        drawDistributionChart(optimizer.distribution || new Map());
        drawOrientationInfoTable(optimizer.orientationInfo || []);
        outputEl.textContent = optimizer.formatCandidate(candidate, formatOptions);
        drawCostTable(optimizer.analyzeCandidate(candidate, formatOptions));

        const size = optimizer.options?.cubeSize;
        const sizeStr = `${size}x${size}`;
        const inputNot = !parseResult?.resolvedNotation ? "Unknown" : (parseResult.resolvedNotation === "sign" ? "SiGN" : "WCA");
        const notStr = `${inputNot}→WCA`;

        metaContainer.style.display = "block";
        metaText.textContent = `Size: ${sizeStr}  •  Notation: ${notStr}`;

        paginationContainer.style.display = "flex";
        indicator.textContent = `Scramble ${validIndex + 1} of ${total}`;
        prevBtn.disabled = validIndex <= 0;
        nextBtn.disabled = validIndex >= total - 1;
    }
    else {
        drawDistributionChart(new Map());
        drawOrientationInfoTable([]);
        drawCostTable([]);
        outputEl.textContent = "";
        getElement("searchTime", HTMLElement).textContent = "";

        metaContainer.style.display = "none";
        paginationContainer.style.display = "none";
    }
    await new Promise(requestAnimationFrame);
}

/**
 * Chart the number of found scrambles for each cost
 * @param {Map<number, number>} distribution 
 */
function drawDistributionChart(distribution) {
    const chartContainer = getElement("myChart", HTMLElement);
    chartContainer.replaceChildren();

    const isMap = distribution instanceof Map;
    if (!isMap || distribution.size === 0) {
        const emptyDiv = document.createElement("div");
        emptyDiv.className = "chart-empty";
        emptyDiv.textContent = "No stats available";
        chartContainer.appendChild(emptyDiv);
        getElement("samples", HTMLElement).textContent = "-";
        getElement("averageCost", HTMLElement).textContent = "-";
        getElement("standardDeviation", HTMLElement).textContent = "-";
        getElement("skewness", HTMLElement).textContent = "-";
        getElement("minZ", HTMLElement).textContent = "-";
        return;
    }

    const samples =  Array.from(distribution.values()).reduce((a, b) => a + b, 0);
    const mean =     Array.from(distribution.entries()).reduce((sum, [cost, count]) => sum + cost * count, 0) / samples;
    const variance = Array.from(distribution.entries()).reduce((sum, [cost, count]) => sum + count * Math.pow(cost - mean, 2), 0) / samples;
    const stdDev = Math.sqrt(variance);
    const skewness = stdDev > 0 ? Array.from(distribution.entries()).reduce((sum, [cost, count]) => sum + count * Math.pow((cost - mean) / stdDev, 3), 0) / samples : 0;

    const minCost = Math.min(...distribution.keys());
    const zScore = stdDev > 0 ? (minCost - mean) / stdDev : 0;

    getElement("samples", HTMLElement).textContent = String(samples);
    getElement("averageCost", HTMLElement).textContent = mean.toFixed(3);
    getElement("standardDeviation", HTMLElement).textContent = stdDev.toFixed(3);
    getElement("skewness", HTMLElement).textContent = skewness.toFixed(3);
    getElement("minZ", HTMLElement).textContent = zScore.toFixed(3);

    // Aggregate into integer bins for UI chart display
    const intMap = new Map();
    for (const [cost, count] of distribution.entries()) {
        const intCost = Math.round(cost);
        intMap.set(intCost, (intMap.get(intCost) || 0) + count);
    }

    const rawIntCosts = Array.from(intMap.keys()).sort((a, b) => a - b);
    const minIntCost = rawIntCosts[0];
    const maxIntCost = rawIntCosts[rawIntCosts.length - 1];
    const span = maxIntCost - minIntCost;

    const targetCols = 100;
    const binStep = Math.max(1, Math.ceil(span / targetCols));

    // Aggregate into bins
    const binnedMap = new Map();
    for (const [cost, count] of intMap.entries()) {
        const binKey = Math.floor((cost - minIntCost) / binStep) * binStep + minIntCost;
        binnedMap.set(binKey, (binnedMap.get(binKey) || 0) + count);
    }

    const costs = [];
    for (let c = minIntCost; c <= maxIntCost; c += binStep) {
        costs.push(c);
    }
    const counts = costs.map(c => binnedMap.get(c) || 0);
    const maxCount = Math.max(...counts);

    // Create the visual CSS bar chart
    const wrapper = document.createElement("div");
    wrapper.className = "chart-wrapper";

    const barsContainer = document.createElement("div");
    barsContainer.className = "chart-bars-container";

    costs.forEach((cost, idx) => {
        const count = counts[idx];
        const percent = (count / maxCount) * 100;
        
        const col = document.createElement("div");
        col.className = "chart-col";

        const bar = document.createElement("div");
        bar.className = "chart-bar";
        bar.style.height = `${percent}%`;
        bar.title = `Cost ~${cost}: Count ${count}`;

        const label = document.createElement("div");
        label.className = "chart-label";
        const step = Math.max(1, Math.floor(costs.length / 5));
        if (idx === 0) {
            label.classList.add("chart-label-first");
            label.textContent = cost;
        } else if (idx === costs.length - 1) {
            label.classList.add("chart-label-last");
            label.textContent = cost;
        } else if (idx % step === 0 && (costs.length - 1 - idx) > Math.floor(step / 2)) {
            label.textContent = cost;
        }

        col.appendChild(bar);
        col.appendChild(label);
        barsContainer.appendChild(col);
    });

    wrapper.appendChild(barsContainer);
    chartContainer.appendChild(wrapper);
}

/**
 * Get a color between red and green based on value
 * @param {number} cost 
 * @param {number} maxAbsCost The magnitude needed for maximum color
 * @param {number} shift Amount to move base color
 */
export function costToColor(cost, maxAbsCost, shift) {
    cost += shift;
    const ratio = Math.max(-1, Math.min(1, cost / maxAbsCost));
    const hue = 60 - ratio * 60;
    return `hsl(${hue}, 100%, 65%)`;
}

/**
 * Renders scramble breakdown rows and total summary row into a target tbody element.
 * @param {HTMLTableSectionElement} tbody 
 * @param {ScrambleBreakdownEntry[]} breakdownEntries 
 * @param {(cost: number) => string} [costToStyleFn] Optional styling function returning CSS string or color
 */
export function renderBreakdownTable(tbody, breakdownEntries, costToStyleFn) {
    tbody.replaceChildren();

    let accumulated = 0;
    for (const entry of breakdownEntries || []) {
        accumulated += entry.addedCost;
        const tr = document.createElement("tr");
        if (entry.isPartitionBoundary) {
            tr.classList.add("cubecapo-partition-boundary");
        }

        const tdMove = document.createElement("td");
        tdMove.className = "cubecapo-semibold";
        tdMove.textContent = entry.move;

        const tdGrip = document.createElement("td");
        tdGrip.textContent = entry.transition?.next || "(none)";

        const tdTrick = document.createElement("td");
        tdTrick.textContent = entry.transition?.type || "(none)";

        const tdCost = document.createElement("td");
        tdCost.className = "cubecapo-right cubecapo-semibold";
        if (costToStyleFn) {
            const styleRes = costToStyleFn(entry.addedCost);
            if (styleRes.startsWith("hsl") || styleRes.startsWith("#") || styleRes.startsWith("rgb")) {
                tdCost.style.background = styleRes;
                tdCost.style.textAlign = "right";
            } else if (styleRes) {
                tdCost.style.cssText = styleRes;
            }
        } else {
            tdCost.style.textAlign = "right";
        }
        tdCost.textContent = String(entry.addedCost);

        if (entry.costBreakdown && Object.keys(entry.costBreakdown).length > 0) {
            const tooltipParts = Object.entries(entry.costBreakdown).filter(([k, v]) => { return v > 0 }).map(([k, v]) => `${k}: ${v}`);
            tdCost.title = tooltipParts.join(", ");
        }

        tr.appendChild(tdMove);
        tr.appendChild(tdGrip);
        tr.appendChild(tdTrick);
        tr.appendChild(tdCost);
        tbody.appendChild(tr);
    }

    const totalRow = document.createElement("tr");
    totalRow.className = "cubecapo-total-row";

    const tdTotalLabel = document.createElement("td");
    tdTotalLabel.colSpan = 3;
    const bLabel = document.createElement("b");
    bLabel.textContent = "Total cost";
    tdTotalLabel.appendChild(bLabel);

    const tdTotalCost = document.createElement("td");
    tdTotalCost.className = "cubecapo-right";
    const bCost = document.createElement("b");
    bCost.textContent = accumulated.toFixed(1);
    tdTotalCost.appendChild(bCost);

    totalRow.appendChild(tdTotalLabel);
    totalRow.appendChild(tdTotalCost);
    tbody.appendChild(totalRow);
}

/**
 * Display grip, fingertrick, and cost of each move
 * @param {ScrambleBreakdownEntry[]} breakdowns
 */
function drawCostTable(breakdowns) {
    const tbody = queryElementOptional(document, "#costTable tbody", HTMLTableSectionElement);
    if (tbody) {
        renderBreakdownTable(tbody, breakdowns, (/** @type {number} */ cost) => costToColor(cost, 5, -2));
    }
}

/**
 * Show the iteration count and best cost for each orientation
 * @param {OrientationResultInfo[]} info
 */
function drawOrientationInfoTable(info) {
    const tbody = queryElementOptional(document, "#orientationTable tbody", HTMLTableSectionElement);
    if (!tbody) return;
    tbody.replaceChildren();

    let total = 0;
    for (const row of info) { //TODO sort by best cost
        total += row.iterations;
        const tr = document.createElement("tr");

        const tdRotation = document.createElement("td");
        const startRotations = [row.startingRotation?.up, row.startingRotation?.front].filter(Boolean).join(" ");
        tdRotation.textContent = startRotations || "(none)";

        const tdIterations = document.createElement("td");
        if (row.maxed) {
            tdIterations.style.background = "#ff0000";
        }
        tdIterations.textContent = String(row.iterations);

        const tdCost = document.createElement("td");
        tdCost.style.background = costToColor(row.cost, 80, -20);
        tdCost.style.textAlign = "right";
        tdCost.textContent = String(row.cost);

        tr.appendChild(tdRotation);
        tr.appendChild(tdIterations);
        tr.appendChild(tdCost);
        tbody.appendChild(tr);
    }

    const totalRow = document.createElement("tr");
    const tdTotalLabel = document.createElement("td");
    tdTotalLabel.colSpan = 1;
    const bLabel = document.createElement("b");
    bLabel.textContent = "Total Iterations";
    tdTotalLabel.appendChild(bLabel);

    const tdTotalVal = document.createElement("td");
    const bVal = document.createElement("b");
    bVal.textContent = String(total);
    tdTotalVal.appendChild(bVal);

    totalRow.appendChild(tdTotalLabel);
    totalRow.appendChild(tdTotalVal);
    tbody.appendChild(totalRow);
}