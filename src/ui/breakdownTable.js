/**
 * Renders scramble breakdown rows and total summary row into a target tbody element.
 * @param {HTMLTableSectionElement} tbody 
 * @param {Array<{move: string, addedCost: number, transition?: {next?: string, type?: string}}>} breakdownEntries 
 * @param {(cost: number) => string} [costToStyleFn] Optional styling function returning CSS string or color
 */
function renderBreakdownTable(tbody, breakdownEntries, costToStyleFn) {
    tbody.replaceChildren();

    let accumulated = 0;
    for (const entry of breakdownEntries || []) {
        accumulated += entry.addedCost;
        const tr = document.createElement("tr");

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
        tdCost.textContent = entry.addedCost;

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

if (typeof globalThis !== "undefined") {
    globalThis.renderBreakdownTable = renderBreakdownTable;
}
