/** @import { ScrambleBreakdownEntry, OrientationResultInfo } from "../types.js" */
/** @import { ScrambleOptimizer } from "../cube/scramble.js" */

/**
 * Show all the results of the scramble optimizer
 * @param {ScrambleOptimizer} optimizer 
 */
export async function drawOptimizerStats(optimizer) {
    if(optimizer) {
        drawDistributionChart(optimizer.distribution);
        drawRotationInfoTable(optimizer.rotationInfo);
        document.getElementById("output").textContent = optimizer.getBestAsString();
        drawCostTable(optimizer.analyzeBest());
    }
    else {
        drawDistributionChart([]);
        drawRotationInfoTable([]);
        drawCostTable([]);
        document.getElementById("output").textContent = "";
        document.getElementById("searchTime").innerHTML = "";
    }
    await new Promise(requestAnimationFrame);
}

/**
 * Chart the number of found scrambles for each cost
 * @param {Map<number, number>} distribution 
 */
function drawDistributionChart(distribution) {
    const chartContainer = document.getElementById("myChart");
    chartContainer.innerHTML = "";

    const isMap = distribution instanceof Map;
    if (!isMap || distribution.size === 0) {
        chartContainer.innerHTML = `<div class="chart-empty">No stats available</div>`;
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
    tbody.innerHTML = "";

    let total = 0;
    for (const row of breakdowns) {
        total += row.addedCost;
        const tr = document.createElement("tr");
        const color = costToColor(row.addedCost, 5, -2);
        tr.innerHTML = `
            <td>${row.move}</td>
            <td>${row.transition?.next || "(none)"}</td>
            <td>${row.transition?.type || "(none)"}</td>
            
            <td style="background:${color};text-align:right">${row.addedCost}</td>
        `;
        tbody.appendChild(tr);
    }

    const totalRow = document.createElement("tr");
    totalRow.innerHTML = `<td colspan="2"><b>Total</b></td><td><b>${total}</b></td>`;
    tbody.appendChild(totalRow);
}

/**
 * Show the iteration count and best cost for each orientation
 * @param {OrientationResultInfo[]} info
 */
function drawRotationInfoTable(info) {
    const tbody = document.querySelector("#rotationTable tbody");
    tbody.innerHTML = "";

    let total = 0;
    for (const row of info) { //TODO sort by best cost
        total += row.iterations;
        const tr = document.createElement("tr");
        const color = costToColor(row.cost, 80, -20); //TODO set this based on average costs?
        tr.innerHTML = `
            <td>${row.rotation.up} ${row.rotation.front}</td>
            <td style=${row.maxed ? `background:#ff0000` : ""}>${row.iterations}</td>
            <td style="background:${color};text-align:right">${row.cost}</td>
        `;
        tbody.appendChild(tr);
    }
    const totalRow = document.createElement("tr");
    totalRow.innerHTML = `<td colspan="1"><b>Total Iterations</b></td><td><b>${total}</b></td>`;
    tbody.appendChild(totalRow);
}