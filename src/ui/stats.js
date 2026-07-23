/** @import { ScrambleBreakdownEntry, OrientationResultInfo, FormatOptions } from "../types.js" */
/** @import { ScrambleOptimizer } from "../cube/scramble.js" */

/**
 * Show all the results of the scramble optimizer
 * @param {ScrambleOptimizer} optimizer 
 * @param {FormatOptions} [formatOptions]
 */
export async function drawOptimizerStats(optimizer, formatOptions) {
    if(optimizer) {
        const opts = formatOptions || {
            showGrips: document.getElementById("showGrips")?.checked ?? true
        };
        drawDistributionChart(optimizer.distribution);
        drawRotationInfoTable(optimizer.rotationInfo);
        document.getElementById("output").textContent = optimizer.getBestAsString(opts);
        drawCostTable(optimizer.analyzeBest());
    }
    else {
        drawDistributionChart([]);
        drawRotationInfoTable([]);
        drawCostTable([]);
        document.getElementById("output").textContent = "";
        document.getElementById("searchTime").textContent = "";
    }
    await new Promise(requestAnimationFrame);
}

/**
 * Chart the number of found scrambles for each cost
 * @param {Map<number, number>} distribution 
 */
function drawDistributionChart(distribution) {
    const chartContainer = document.getElementById("myChart");
    chartContainer.replaceChildren();

    const isMap = distribution instanceof Map;
    if (!isMap || distribution.size === 0) {
        const emptyDiv = document.createElement("div");
        emptyDiv.className = "chart-empty";
        emptyDiv.textContent = "No stats available";
        chartContainer.appendChild(emptyDiv);
        document.getElementById("samples").textContent = "-";
        document.getElementById("averageCost").textContent = "-";
        document.getElementById("standardDeviation").textContent = "-";
        document.getElementById("skewness").textContent = "-";
        document.getElementById("minZ").textContent = "-";
        return;
    }

    const costs = Array.from(distribution.keys()).sort((a, b) => a - b);
    const counts = costs.map(c => distribution.get(c));
    const maxCount = Math.max(...counts);

    const samples =  Array.from(distribution.values()).reduce((a, b) => a + b, 0);
    const mean =     Array.from(distribution.entries()).reduce((sum, [cost, count]) => sum + cost * count, 0) / samples;
    const variance = Array.from(distribution.entries()).reduce((sum, [cost, count]) => sum + count * Math.pow(cost - mean, 2), 0) / samples;
    const stdDev = Math.sqrt(variance);
    const skewness = stdDev > 0 ? Array.from(distribution.entries()).reduce((sum, [cost, count]) => sum + count * Math.pow((cost - mean) / stdDev, 3), 0) / samples : 0;

    const minCost = Math.min(...distribution.keys());
    const zScore = stdDev > 0 ? (minCost - mean) / stdDev : 0;

    document.getElementById("samples").textContent = samples;
    document.getElementById("averageCost").textContent = mean.toFixed(3);
    document.getElementById("standardDeviation").textContent = stdDev.toFixed(3);
    document.getElementById("skewness").textContent = skewness.toFixed(3);
    document.getElementById("minZ").textContent = zScore.toFixed(3);

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
        bar.title = `Cost: ${cost}, Count: ${count}`;

        const label = document.createElement("div");
        label.className = "chart-label";
        if (idx === 0 || idx === costs.length - 1 || idx % Math.max(1, Math.floor(costs.length / 5)) === 0) {
            label.textContent = cost.toFixed(1);
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
 * Display grip, fingertrick, and cost of each move
 * @param {ScrambleBreakdownEntry[]} breakdowns
 */
function drawCostTable(breakdowns) {
    const tbody = document.querySelector("#costTable tbody");
    renderBreakdownTable(tbody, breakdowns, (cost) => costToColor(cost, 5, -2));
}

/**
 * Show the iteration count and best cost for each orientation
 * @param {OrientationResultInfo[]} info
 */
function drawRotationInfoTable(info) {
    const tbody = document.querySelector("#rotationTable tbody");
    tbody.replaceChildren();

    let total = 0;
    for (const row of info) { //TODO sort by best cost
        total += row.iterations;
        const tr = document.createElement("tr");

        const tdRotation = document.createElement("td");
        tdRotation.textContent = `${row.rotation.up} ${row.rotation.front}`;

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