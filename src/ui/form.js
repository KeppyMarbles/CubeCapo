import { ScrambleOptimizer } from "../cube/scramble.js";
import { costToColor } from "./stats.js";
import { defaultCostConfiguration, defaultFormatOptions, defaultRunOptions } from "../cube/defaults.js";
import { getElement, getOptionalElement, queryElementOptional, queryElements } from "./dom.js";
/** @import { CostConfig, RunOptions, FormatOptions } from "../types.js" */
/** @import { Move } from "../cube/move.js" */

/**
 * @typedef {Object} GroupControl
 * @property {string} label
 * @property {string[]} targets
 */

/**
 * Set up everything needed for the user to configure the optimizer
 * @param {(config: CostConfig, scramble: Move[], options: RunOptions) => Promise<void> | void} onSubmit
 * @param {() => void} [onFormatChange] Called whenever a format option changes
 */
export async function setupForm(onSubmit, onFormatChange) {
    let initialConfig = await loadCostConfig();
    if (initialConfig)
        initialConfig = migrateConfig(initialConfig, defaultCostConfiguration);
    else
        initialConfig = defaultCostConfiguration;

    let savedConfig = structuredClone(initialConfig);

    /**
     * Set scramble input value, clean up pending storage, and trigger auto-submit
     * @param {string} text 
     */
    const applyScrambleAndSubmit = (text) => {
        const input = getOptionalElement("scramble", HTMLInputElement);
        if (!input) return;

        input.value = text || "";

        if (text) {
            if (typeof chrome !== "undefined" && chrome.storage?.local) {
                chrome.storage.local.remove(["pendingScramble"]);
            }
            setTimeout(() => {
                getOptionalElement("submitButton", HTMLButtonElement)?.click();
            }, 50);
        }
    };

    // Initial scramble population on setup
    const urlScramble = new URLSearchParams(window.location.search).get("scramble");
    if (urlScramble) {
        applyScrambleAndSubmit(urlScramble);
    } else if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.get(["pendingScramble"], (store) => {
            applyScrambleAndSubmit(String(store?.pendingScramble || ""));
        });
    } else {
        applyScrambleAndSubmit("");
    }

    // Real-time updates for already-open settings tabs
    if (typeof chrome !== "undefined") {
        chrome.storage?.onChanged?.addListener((changes, area) => {
            if (area === "local" && changes.pendingScramble?.newValue) {
                applyScrambleAndSubmit(String(changes.pendingScramble.newValue || ""));
            }
        });

        chrome.runtime?.onMessage?.addListener((msg) => {
            if (msg.action === "LOAD_PENDING_SCRAMBLE" && msg.scrambleText) {
                applyScrambleAndSubmit(String(msg.scrambleText || ""));
            }
        });
    }

    const form = getOptionalElement("costForm", HTMLFormElement);
    if (!form) return;

    {
        /** @type {Record<string, string>} */
        const formAlias = {
            "regrip": "Base Regrip",
            "regripPerStep": "Regrip Per Step",
            //"double": "Double Move",
            "repeatPenalty": "Repeat Fingertrick",
            "perSliceFingertrick": "Per-Slice Fingertrick Cost"
        };

        /** @type {Record<string, string>} */
        const formTitles = {
            "regripPerStep": "Cost added for each step moved along the thumb chain (Bd <-> D <-> F <-> U <-> Bu)",
            "double": "Only effective if Wide Replace Double is active",
            "repeatPenalty": "The cost of doing the same fingertrick twice in a row",
            "perSliceFingertrick": "If the fingertrick cost should be applied per effective slice"
        };

        /** @type {Record<string, string>} */
        const formTypes = {
            "perSliceFingertrick": "checkbox"
        };
      
        /** @type {Record<string, (key: string) => number>} */
        const columnClassifiers = {
            "general": () => 0,
            "alpha": (key) => ["x", "y", "z"].includes(key) ? 2 : (key === key.toLowerCase() ? 1 : 0),
            "grip": (key) => {
                const firstGrip = key.split(" ")[0];
                const order = ["F", "U", "D", "Bd", "Bu"];
                const idx = order.indexOf(firstGrip);
                return idx !== -1 ? idx : 0;
            },
            "fingertrick": (key) => {
                if (key.startsWith("right_")) return 1;
                return 0;
            }
        };

        for (const [groupName, groupValue] of Object.entries(initialConfig)) {
            const groupDiv = queryElementOptional(form, `[data-group="${groupName}"]`, HTMLElement);
            if (!groupDiv || typeof groupValue !== "object" || !groupValue) continue;

            const gridDiv = document.createElement("div");
            gridDiv.className = "cost-category-grid";

            const getColumnIndex = columnClassifiers[groupName] || (() => 0);
            /** @type {Map<number, HTMLDivElement>} */
            const colMap = new Map();

            for (const [key, val] of Object.entries(groupValue)) {
                const colIdx = getColumnIndex(key);
                if (!colMap.has(colIdx)) {
                    const col = document.createElement("div");
                    col.className = "cost-col";
                    colMap.set(colIdx, col);
                }
                const colDiv = colMap.get(colIdx);
                if (!colDiv) continue;

                const label = document.createElement("label");
                label.textContent = formAlias[key] || key;
                label.title = formTitles[key] || "";
                const input = document.createElement("input");
                input.type = formTypes[key] || "number";
                input.name = `${groupName}.${key}`;
                if (input.type === "checkbox") {
                    input.checked = Boolean(val);
                } else {
                    input.step = "0.5";
                    input.value = String(val);
                    input.dataset.valueType = "additive";
                }
                label.appendChild(input);
                colDiv.appendChild(label);
            }

            // Append columns sorted by index
            const sortedIndices = Array.from(colMap.keys()).sort((a, b) => a - b);
            for (const idx of sortedIndices) {
                const col = colMap.get(idx);
                if (col) gridDiv.appendChild(col);
            }
            groupDiv.appendChild(gridDiv);
        }
    }

    const runOpts = /** @type {RunOptions} */ (await loadOptions("runOptions", defaultRunOptions));
    let savedRunOpts = structuredClone(runOpts);
    applyRunOptionsValues(runOpts);

    const formatOpts = /** @type {FormatOptions} */ (await loadOptions("formatOptions", defaultFormatOptions));
    applyFormatOptionsValues(formatOpts);

    // Live update check for unsaved bar
    const checkUnsavedChanges = () => {
        const currentConfig = collectCostConfig(form, savedConfig);
        const currentRunOpts = collectRunOptionsValues();

        const configDiff = JSON.stringify(currentConfig) !== JSON.stringify(savedConfig);
        const optsDiff = JSON.stringify(currentRunOpts) !== JSON.stringify(savedRunOpts);

        const bar = getOptionalElement("unsavedChangesBar", HTMLElement);
        if (bar) {
            if (configDiff || optsDiff) {
                bar.classList.remove("hidden");
            } else {
                bar.classList.add("hidden");
            }
        }
    };

    // Attach change detection to computation settings (require explicit save)
    const computeInputIds = [
        "depth",
        "iterations",
        "maxRegripBranches",
        "searchRotations",
        "pruneRotations",
        "memoize",
        "wideReplace",
        //"wideReplaceDouble",
        //"allowMidScrambleRotations",
        "partitionLength",
        "cubeSize"
    ];
    computeInputIds.forEach(id => {
        const el = getOptionalElement(id, HTMLElement);
        if (el) {
            el.addEventListener("input", checkUnsavedChanges);
            el.addEventListener("change", checkUnsavedChanges);
        }
    });

    // Format options: auto-save on change and trigger live update (no unsaved bar)
    const formatInputIds = ["showGrips", "showBoundaries", "wedgeNotation", "showOrientationColors", "reorient"];
    formatInputIds.forEach(id => {
        const el = getOptionalElement(id, HTMLElement);
        if (el) {
            el.addEventListener("change", async () => {
                await saveOptions("formatOptions", collectFormatOptionsValues());
                onFormatChange?.();
            });
        }
    });

    // Unsaved Changes Bar click listeners
    getOptionalElement("saveChangesButton", HTMLButtonElement)?.addEventListener("click", async () => {
        const config = collectCostConfig(form, savedConfig);
        await saveCostConfig(config);

        const runOptions = collectRunOptionsValues();
        await saveOptions("runOptions", runOptions);

        savedConfig = structuredClone(config);
        savedRunOpts = structuredClone(runOptions);

        // Notify options page / content scripts of settings change
        if (typeof chrome !== "undefined" && chrome.tabs) {
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    if (tab.id) {
                        chrome.tabs.sendMessage(tab.id, { action: "SETTINGS_CHANGED" }, () => {
                            if (chrome.runtime.lastError) { /* ignore */ }
                        });
                    }
                });
            });
        }

        checkUnsavedChanges();
    });

    getOptionalElement("revertChangesButton", HTMLButtonElement)?.addEventListener("click", () => {
        applyConfig(form, savedConfig);
        applyRunOptionsValues(savedRunOpts);

        updateCostInputColors(form);
        checkUnsavedChanges(); //TODO not always working?
    });

    // Submit handler
    getOptionalElement("submitButton", HTMLButtonElement)?.addEventListener("click", async (e) => {
        e.preventDefault();
        const errEl = getOptionalElement("errorMessage", HTMLElement);
        if (errEl) errEl.textContent = "";
        try {
            const config = collectCostConfig(form, savedConfig);
            const scrambleInput = getOptionalElement("scramble", HTMLInputElement);
            const rawText = scrambleInput ? scrambleInput.value.trim() : "";
            if (!rawText) {
                throw new Error("Please enter a scramble to analyze.");
            }
            const scramble = ScrambleOptimizer.parseScramble(rawText);
            const options = collectRunOptionsValues();
            await onSubmit(config, scramble, options);
        } 
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (errEl) errEl.textContent = "Error: " + msg;
        }
    });

    getOptionalElement("resetDefaultButton", HTMLButtonElement)?.addEventListener("click", () => {
        applyConfig(form, defaultCostConfiguration);
        form.dispatchEvent(new Event("input", { bubbles: true }));
    });

    queryElements(document, '.tab-buttons button', HTMLButtonElement).forEach(btn => {
        btn.addEventListener('click', () => {
            queryElements(document, '.tab-buttons button', HTMLButtonElement).forEach(b => b.classList.remove('active'));
            queryElements(document, '.tab-content', HTMLElement).forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const targetTab = btn.dataset.tab;
            if (targetTab) {
                getOptionalElement(targetTab, HTMLElement)?.classList.add('active');
            }
        });
    });

    addGroupControls(form, "fingertrick", [
        { label: "Pushes", targets: ["right_index_push", "right_middle_push", "right_ring_push", "left_index_push", "left_middle_push", "left_ring_push"]},
        { label: "Index Finger", targets: ["right_index", "right_index_push", "right_index_front", "right_index_middle", "left_index", "left_index_push", "left_index_front", "left_index_middle"]},
        { label: "Middle Finger", targets: ["right_middle", "right_middle_push", "left_middle", "left_middle_push"]},
        { label: "Ring Finger", targets: ["right_ring", "right_ring_middle", "right_ring_push", "left_ring", "left_ring_middle", "left_ring_push"]},
        { label: "Thumbs", targets: ["right_thumb", "left_thumb"]},
        { label: "Twist Up", targets: ["right_up", "right_up_double", "left_up", "left_up_double"]},
        { label: "Twist Down", targets: ["right_down", "right_down_double", "left_down", "left_down_double"]},
        { label: "", targets: []},
        { label: "Right Hand", targets: ["right_index", "right_index_push", "right_index_front", "right_index_middle", "right_middle", "right_middle_push", "right_ring", "right_ring_middle", "right_ring_push", "right_thumb", "right_up", "right_up_double", "right_down", "right_down_double"]},
        { label: "Left Hand", targets: ["left_index", "left_index_push", "left_index_front", "left_index_middle", "left_middle", "left_middle_push", "left_ring", "left_ring_middle", "left_ring_push", "left_thumb", "left_up", "left_up_double", "left_down", "left_down_double"]},
    ]);

    addGroupControls(form, "grip", [
        { label: "Left Thumb Front", targets: ["F F", "F U", "F D", "F Bu", "F Bd"]},
        { label: "Left Thumb Up", targets: ["U F", "U U", "U D", "U Bu", "U Bd"]},
        { label: "Left Thumb Down", targets: ["D F", "D U", "D D", "D Bu", "D Bd"]},
        { label: "Left Thumb Back", targets: ["Bu F", "Bu U", "Bu D", "Bu Bu", "Bu Bd", "Bd F", "Bd U", "Bd D", "Bd Bu", "Bd Bd"]},
        { label: "", targets: []},
        { label: "Right Thumb Front", targets: ["F F", "U F", "D F", "Bu F", "Bd F"]},
        { label: "Right Thumb Up", targets: ["F U", "U U", "D U", "Bu U", "Bd U"]},
        { label: "Right Thumb Down", targets: ["F D", "U D", "D D", "Bu D", "Bd D"]},
        { label: "Right Thumb Back", targets: ["F Bu", "U Bu", "D Bu", "Bu Bu", "Bd Bu", "F Bd", "U Bd", "D Bd", "Bu Bd", "Bd Bd"]},
        { label: "", targets: []},
        { label: "Both Up or Down", targets: ["U U", "D D"]},
        { label: "Both Back", targets: ["Bd Bd", "Bu Bu", "Bd Bu", "Bu Bd"]},
    ]);

    addGroupControls(form, "alpha", [
        { label: "Front", targets: ["F", "f"]},
        { label: "Back", targets: ["B", "b"]},
        { label: "Right", targets: ["R", "r"]},
        { label: "Left", targets: ["L", "l"]},
        { label: "Up", targets: ["U", "u"]},
        { label: "Down", targets: ["D", "d"]},
        { label: "", targets: []},
        { label: "Normal", targets: ["F", "B", "R", "L", "U", "D"]},
        { label: "Wide", targets: ["f", "b", "r", "l", "u", "d"]},
        //{ label: "Rotation", targets: ["x", "y", "z"]},
    ]);

    getOptionalElement("exportButton", HTMLButtonElement)?.addEventListener("click", () => {
        try {
            const config = collectCostConfig(form, initialConfig);
            const json = JSON.stringify(config, null, 2);
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = "scramble-config.json";
            a.click();
            URL.revokeObjectURL(url);
        } 
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            alert("Error exporting configuration: " + msg);
        }
    });
    
    const importFile = getOptionalElement("importFile", HTMLInputElement);

    getOptionalElement("importButton", HTMLButtonElement)?.addEventListener("click", () => {
        if (importFile) {
            importFile.click();
        }
    });

    if (importFile) {
        importFile.addEventListener("change", async (e) => {
            const target = e.target;
            if (!(target instanceof HTMLInputElement)) return;
            const file = target.files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const config = JSON.parse(text);
                const costForm = getOptionalElement("costForm", HTMLFormElement);
                if (costForm) {
                    applyConfig(costForm, config);
                    form.dispatchEvent(new Event("input", { bubbles: true }));
                }
            } 
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                alert("Error importing configuration: " + msg);
            }

            importFile.value = "";
        });
    }

    form.addEventListener("input", (e) => {
        const target = e.target;
        if (target instanceof HTMLInputElement && target.type === "number") {
            updateCostInputColors(form);
        }
        checkUnsavedChanges();
    });

    updateCostInputColors(form);
}

/**
 * @param {Record<string, any>} imported 
 * @param {Record<string, any>} defaults 
 * @returns {CostConfig}
 */
function migrateConfig(imported, defaults) {
    const output = /** @type {any} */ (structuredClone(defaults));
    for (const [key, value] of Object.entries(imported)) {
        if (key in defaults) {
            if (typeof value === "object" && value !== null) {
                for (const [sub, subVal] of Object.entries(value)) {
                    if (sub in defaults[key] && typeof subVal === typeof defaults[key][sub]) {
                        output[key][sub] = subVal;
                    }
                }
            } 
            else if (typeof value === typeof defaults[key]) {
                output[key] = value;
            }
        }
    }
    return /** @type {CostConfig} */ (output);
}

/**
 * Adds bulk adjustments to the form
 * @param {HTMLFormElement} form 
 * @param {string} groupName 
 * @param {GroupControl[]} controls 
 */
function addGroupControls(form, groupName, controls) {
    const groupDiv = queryElementOptional(form, `[data-group="${groupName}"]`, HTMLElement);
    if (!groupDiv) return;

    // Add a visual separator
    const separator = document.createElement("hr");
    separator.className = "group-separator";
    groupDiv.appendChild(separator);

    // Create a section header
    const header = document.createElement("h4");
    header.textContent = "Adjustments";
    groupDiv.appendChild(header);

    // Create controls
    for (const ctrl of controls) {
        if (ctrl.label === "") {
            const spacer = document.createElement("div");
            spacer.style.height = "8px";
            groupDiv.appendChild(spacer);
            continue;
        }

        const wrapper = document.createElement("div");
        wrapper.className = "adjustment-row";

        const labelSpan = document.createElement("span");
        labelSpan.textContent = ctrl.label;
        wrapper.appendChild(labelSpan);

        const btnGroup = document.createElement("div");
        btnGroup.className = "btn-adjust-group";

        const minus = document.createElement("button");
        minus.type = "button";
        minus.className = "btn-adjust";
        minus.textContent = "−";
        minus.dataset.group = groupName;
        minus.dataset.delta = "-0.5";

        const plus = document.createElement("button");
        plus.type = "button";
        plus.className = "btn-adjust";
        plus.textContent = "+";
        plus.dataset.group = groupName;
        plus.dataset.delta = "0.5";

        btnGroup.appendChild(minus);
        btnGroup.appendChild(plus);
        wrapper.appendChild(btnGroup);
        groupDiv.appendChild(wrapper);

        for (const btn of [minus, plus]) {
            btn.addEventListener('click', () => {
                const delta = parseFloat(btn.dataset.delta || "0");
                queryElements(form, `[name^="${groupName}."]`, HTMLInputElement).forEach(input => {
                    if (ctrl.targets.includes(input.name.split(".")[1])) {
                        const oldVal = parseFloat(input.value) || 0;
                        input.value = String(oldVal + delta);
                    }
                });
                updateCostInputColors(form);
                form.dispatchEvent(new Event("input", { bubbles: true }));
            });
        }
    }

    const zeroButton = document.createElement("button");
    zeroButton.textContent = "Zero All";
    zeroButton.type = "button";
    zeroButton.className = "btn-zero";
    groupDiv.appendChild(zeroButton);

    zeroButton.addEventListener('click', () => {
        queryElements(form, `[name^="${groupName}."]`, HTMLInputElement).forEach(input => {
            input.value = "0";
        });
        updateCostInputColors(form);
        form.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

/**
 * Updates the background color of each numeric input
 * @param {HTMLFormElement} form 
 */
function updateCostInputColors(form) {
    queryElements(form, 'input[type="number"]', HTMLInputElement).forEach(input => {
        const val = parseFloat(input.value);
        if (input.dataset.valueType === "additive")
            input.style.backgroundColor = costToColor(val, 5, -2);
        else if (input.dataset.valueType === "scalar")
            input.style.backgroundColor = costToColor(val, 3, -2);
    });
}

/**
 * Save config to local storage / chrome storage
 * @param {CostConfig} config 
 */
async function saveCostConfig(config) {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        await new Promise((resolve) => {
            chrome.storage.local.set({ costConfig: config }, () => resolve(undefined));
        });
    }
    localStorage.setItem("costConfig", JSON.stringify(config));
}

/**
 * Get the cost configuration saved in storage
 * @returns {Promise<CostConfig | null>}
 */
async function loadCostConfig() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        return new Promise((resolve) => {
            chrome.storage.local.get(["costConfig"], (result) => {
                resolve(/** @type {CostConfig | null} */ (result?.costConfig || null));
            });
        });
    }
    try {
        const stored = localStorage.getItem("costConfig");
        return stored ? JSON.parse(stored) : null;
    } 
    catch {
        return null;
    }
}

/**
 * Save an options object to storage under the given key
 * @param {string} key
 * @param {Object} options
 */
async function saveOptions(key, options) {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        await new Promise((resolve) => {
            chrome.storage.local.set({ [key]: options }, () => resolve(undefined));
        });
    }
    localStorage.setItem(key, JSON.stringify(options));
}

/**
 * Load an options object from storage, falling back to defaults
 * @template T
 * @param {string} key
 * @param {T} defaults
 * @returns {Promise<T>}
 */
async function loadOptions(key, defaults) {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        return new Promise((resolve) => {
            chrome.storage.local.get([key], (result) => {
                const storedVal = result ? result[key] : null;
                resolve({ ...defaults, ...(storedVal || {}) });
            });
        });
    }
    try {
        const stored = localStorage.getItem(key);
        return stored ? { ...defaults, ...JSON.parse(stored) } : { ...defaults };
    }
    catch {
        return { ...defaults };
    }
}

/**
 * Get the cost configuration from the cost form
 * @param {HTMLFormElement} form 
 * @param {CostConfig} initialConfig 
 * @returns {CostConfig}
 */
function collectCostConfig(form, initialConfig) {
    const newConfig = /** @type {any} */ (structuredClone(initialConfig));

    for (const input of queryElements(form, "input[name]", HTMLInputElement)) {
        const fullKey = input.name;
        const val = input.type === "checkbox" ? input.checked : parseFloat(input.value);
        if (fullKey.includes(".")) {
            const [group, subkey] = fullKey.split(".");
            if (newConfig[group]) newConfig[group][subkey] = val;
        } else {
            newConfig[fullKey] = val;
        }
    }

    return /** @type {CostConfig} */ (newConfig);
}

/**
 * Gather the current compute run option values from the DOM
 * @returns {RunOptions}
 */
function collectRunOptionsValues() {
    return {
        ...defaultRunOptions,
        depth: parseFloat(getElement("depth", HTMLInputElement).value),
        maxIterations: parseFloat(getElement("iterations", HTMLInputElement).value),
        maxRegripBranches: parseFloat(getElement("maxRegripBranches", HTMLInputElement).value),
        searchRotations: getElement("searchRotations", HTMLInputElement).checked,
        pruneRotations: getElement("pruneRotations", HTMLInputElement).checked,
        memoize: getElement("memoize", HTMLInputElement).checked,
        wideReplace: getElement("wideReplace", HTMLInputElement).checked,
        partitionLength: parseFloat(getElement("partitionLength", HTMLInputElement).value),
        cubeSize: Number(getElement("cubeSize", HTMLSelectElement).value),
    };
}

/**
 * Gather the current format option values from the DOM
 * @returns {FormatOptions}
 */
export function collectFormatOptionsValues() {
    return {
        ...defaultFormatOptions,
        showGrips: getElement("showGrips", HTMLInputElement).checked,
        showBoundaries: getElement("showBoundaries", HTMLInputElement).checked,
        wedgeNotation: getElement("wedgeNotation", HTMLInputElement).checked,
        showOrientationColors: getElement("showOrientationColors", HTMLInputElement).checked,
        reorient: getElement("reorient", HTMLInputElement).checked,
    };
}

/**
 * Populate the compute option DOM elements with the provided values
 * @param {RunOptions} runOpts
 */
function applyRunOptionsValues(runOpts) {
    const opts = { ...defaultRunOptions, ...runOpts };

    getElement("depth", HTMLInputElement).value = String(opts.depth);
    getElement("iterations", HTMLInputElement).value = String(opts.maxIterations);
    getElement("maxRegripBranches", HTMLInputElement).value = String(opts.maxRegripBranches ?? defaultRunOptions.maxRegripBranches);
    getElement("searchRotations", HTMLInputElement).checked = Boolean(opts.searchRotations ?? defaultRunOptions.searchRotations);
    getElement("pruneRotations", HTMLInputElement).checked = Boolean(opts.pruneRotations ?? defaultRunOptions.pruneRotations);
    getElement("memoize", HTMLInputElement).checked = Boolean(opts.memoize ?? defaultRunOptions.memoize);
    getElement("wideReplace", HTMLInputElement).checked = Boolean(opts.wideReplace ?? defaultRunOptions.wideReplace);
    getElement("partitionLength", HTMLInputElement).value = String(opts.partitionLength ?? defaultRunOptions.partitionLength);
    getElement("cubeSize", HTMLSelectElement).value = String(opts.cubeSize);
}

/**
 * Populate the format option DOM elements with the provided values
 * @param {FormatOptions} formatOpts
 */
function applyFormatOptionsValues(formatOpts) {
    const opts = { ...defaultFormatOptions, ...formatOpts };

    getElement("showGrips", HTMLInputElement).checked = Boolean(opts.showGrips ?? defaultFormatOptions.showGrips);
    getElement("showBoundaries", HTMLInputElement).checked = Boolean(opts.showBoundaries ?? defaultFormatOptions.showBoundaries);
    getElement("wedgeNotation", HTMLInputElement).checked = Boolean(opts.wedgeNotation ?? defaultFormatOptions.wedgeNotation);
    getElement("showOrientationColors", HTMLInputElement).checked = Boolean(opts.showOrientationColors ?? defaultFormatOptions.showOrientationColors);
    getElement("reorient", HTMLInputElement).checked = Boolean(opts.reorient ?? defaultFormatOptions.reorient);
}

/**
 * Populate the form with a given configuration
 * @param {HTMLFormElement} form 
 * @param {Record<string, any>} config 
 */
function applyConfig(form, config) {
    for (const [groupName, groupValue] of Object.entries(config)) {
        if (typeof groupValue === "object" && groupValue !== null) {
            for (const [key, val] of Object.entries(groupValue)) {
                const input = queryElementOptional(form, `[name="${groupName}.${key}"]`, HTMLInputElement);
                if (!input) continue;
                if (input.type === "checkbox") input.checked = Boolean(val);
                else input.value = String(val);
            }
        } 
        else {
            const input = queryElementOptional(form, `[name="${groupName}"]`, HTMLInputElement);
            if (!input) continue;
            if (input.type === "checkbox") input.checked = Boolean(groupValue);
            else input.value = String(groupValue);
        }
    }
    updateCostInputColors(form);
}

/**
 * Show the amount of time taken to optimize
 * @param {number} time 
 */
export function drawSearchTime(time) {
    const el = getOptionalElement("searchTime", HTMLElement);
    if (el) {
        el.textContent = new Date(time).toISOString().slice(11, -1);
    }
}