import { ScrambleOptimizer } from "../cube/scramble.js";
import { costToColor } from "./stats.js";
/** @import { CostConfig, RunOptions } from "../types.js" */

/**
 * @typedef {Object} GroupControl
 * @property {string} label
 * @property {string[]} targets
 */

/**
 * Set up everything needed for the user to configure the optimizer
 * @param {()} onSubmit
 */
export async function setupForm(onSubmit) {
    let initialConfig = await loadCostConfig();
    if(initialConfig)
        initialConfig = migrateConfig(initialConfig, ScrambleOptimizer.defaultCostConfiguration);
    else
        initialConfig = ScrambleOptimizer.defaultCostConfiguration;

    let savedConfig = structuredClone(initialConfig);

    /**
     * Set scramble input value, clean up pending storage, and trigger auto-submit
     * @param {string} text 
     */
    const applyScrambleAndSubmit = (text) => {
        const input = document.getElementById("scramble");
        if (!input) return;

        input.value = text || "";

        if (text) {
            if (typeof chrome !== "undefined" && chrome.storage?.local) {
                chrome.storage.local.remove(["pendingScramble"]);
            }
            setTimeout(() => {
                document.getElementById("submitButton")?.click();
            }, 50);
        }
    };

    // Initial scramble population on setup
    const urlScramble = new URLSearchParams(window.location.search).get("scramble");
    if (urlScramble) {
        applyScrambleAndSubmit(urlScramble);
    } else if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.get(["pendingScramble"], (store) => {
            applyScrambleAndSubmit(store?.pendingScramble || "");
        });
    } else {
        applyScrambleAndSubmit("");
    }

    // Real-time updates for already-open settings tabs
    if (typeof chrome !== "undefined") {
        chrome.storage?.onChanged?.addListener((changes, area) => {
            if (area === "local" && changes.pendingScramble?.newValue) {
                applyScrambleAndSubmit(changes.pendingScramble.newValue);
            }
        });

        chrome.runtime?.onMessage?.addListener((msg) => {
            if (msg.action === "LOAD_PENDING_SCRAMBLE" && msg.scrambleText) {
                applyScrambleAndSubmit(msg.scrambleText);
            }
        });
    }

    /** @type {HTMLFormElement} */
    const form = document.getElementById("costForm");

    {
        const formAlias = {
            "regrip": "Regrip",
            "double": "Double Move",
            "repeatPenalty": "Repeat Fingertrick",
            "wideMultiplier": "Wide Fingertrick Multiplier"
        }

        const formTitles = {
            "double": "Only effective if Wide Replace Double is active",
            "repeatPenalty": "The cost of doing the same fingertrick twice in a row",
            "wideMultiplier": "How much the fingertrick cost should be scaled if it's a wide move"
        }

        const formTypes = {
            "wideMultiplier": "scalar"
        }
      
        for (const [groupName, groupValue] of Object.entries(initialConfig)) {
            const groupDiv = form.querySelector(`[data-group="${groupName}"]`);
            if (!groupDiv || typeof groupValue !== "object") continue;

            const gridDiv = document.createElement("div");
            gridDiv.className = "cost-columns";
            groupDiv.appendChild(gridDiv);

            for (const [key, val] of Object.entries(groupValue)) {
                const label = document.createElement("label");
                label.textContent = formAlias[key] || key;
                label.title = formTitles[key] || "";
                const input = document.createElement("input");
                input.type = "number";
                input.step = "0.5";
                input.name = `${groupName}.${key}`;
                input.value = val;
                input.valueType = formTypes[key] || "additive";
                //input.colorShift = formShifts[key] || -2;
                label.appendChild(input);
                gridDiv.appendChild(label);
            }
        }
    }

    const runOpts = await loadRunOptions();
    let savedRunOpts = structuredClone(runOpts);

    applyRunOptionsValues(runOpts);

    // Check if configuration has unsaved changes
    const checkUnsavedChanges = () => {
        const currentConfig = collectCostConfig(form, savedConfig);
        const currentRunOpts = collectRunOptionsValues();

        const configDiff = JSON.stringify(currentConfig) !== JSON.stringify(savedConfig);
        const optsDiff = JSON.stringify(currentRunOpts) !== JSON.stringify(savedRunOpts);

        const bar = document.getElementById("unsavedChangesBar");
        if (bar) {
            if (configDiff || optsDiff) {
                bar.classList.remove("hidden");
            } else {
                bar.classList.add("hidden");
            }
        }
    };

    // Attach change detection to computation settings
    const computationInputs = ["depth", "iterations", "searchRotations", "searchStartingGrips", "showGrips", "pruneRotations", "memoize", "wideReplaceDouble"];
    computationInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("input", checkUnsavedChanges);
            el.addEventListener("change", checkUnsavedChanges);
        }
    });

    // Unsaved Changes Bar click listeners
    document.getElementById("saveChangesButton").addEventListener("click", async () => {
        const config = collectCostConfig(form, savedConfig);
        await saveCostConfig(config);

        const runOptions = collectRunOptionsValues();
        await saveRunOptions(runOptions);

        savedConfig = structuredClone(config);
        savedRunOpts = structuredClone(runOptions);

        // Notify options page / content scripts of settings change
        if (typeof chrome !== "undefined" && chrome.tabs) {
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, { action: "SETTINGS_CHANGED" }, () => {
                        if (chrome.runtime.lastError) { /* ignore */ }
                    });
                });
            });
        }

        checkUnsavedChanges();
    });

    document.getElementById("revertChangesButton").addEventListener("click", () => {
        applyConfig(form, savedConfig);
        applyRunOptionsValues(savedRunOpts);

        updateCostInputColors(form);
        checkUnsavedChanges();
    });

    // Submit handler
    document.getElementById("submitButton").addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById("errorMessage").textContent = "";
        try {
            const config = collectCostConfig(form, savedConfig);
            const options = collectRunOptions();
            onSubmit(config, options);
        } 
        catch (err) {
            document.getElementById("errorMessage").textContent = "Error: " + err.message;
        }
    });

    document.getElementById("resetDefaultButton").addEventListener("click", (e) => {
        applyConfig(form, ScrambleOptimizer.defaultCostConfiguration);
        form.dispatchEvent(new Event("input", { bubbles: true }));
    });

    document.querySelectorAll('.tab-buttons button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-buttons button').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    addGroupControls(form, "fingertrick", [
        { label: "Pushes", targets: ["right_index_push", "right_ring_push", "left_index_push", "left_ring_push"]},
        { label: "Ring Finger", targets: ["right_ring", "right_ring_middle", "right_ring_push", "left_ring", "left_ring_middle", "left_ring_push"]},
        { label: "Index Finger", targets: ["right_index", "right_index_push", "right_index_middle", "left_index", "left_index_middle"]},
        { label: "Twist Up", targets: ["right_up", "right_up_double", "left_up", "left_up_double"]},
        { label: "Twist Down", targets: ["right_down", "right_down_double", "left_down", "left_down_double"]},
        { label: ""},
        { label: "Right Hand", targets: ["right_index", "right_index_push", "right_index_middle", "right_ring", "right_ring_middle", "right_ring_push", "right_up", "right_up_double", "right_down", "right_down_double"]},
        { label: "Left Hand", targets: ["left_index", "left_index_push", "left_index_middle", "left_ring", "left_ring_middle", "left_ring_push", "left_up", "left_up_double", "left_down", "left_down_double"]},
    ]);

    addGroupControls(form, "grip", [
        { label: "Left Thumb Front", targets: ["F F", "F U", "F D", "F Bu", "F Bd"]},
        { label: "Left Thumb Up", targets: ["U F", "U U", "U D", "U Bu", "U Bd"]},
        { label: "Left Thumb Down", targets: ["D F", "D U", "D D", "D Bu", "D Bd"]},
        { label: "Left Thumb Back", targets: ["Bu F", "Bu U", "Bu D", "Bu Bu", "Bu Bd", "Bd F", "Bd U", "Bd D", "Bd Bu", "Bd Bd"]},
        { label: ""},
        { label: "Right Thumb Front", targets: ["F F", "U F", "D F", "Bu F", "Bd F"]},
        { label: "Right Thumb Up", targets: ["F U", "U U", "D U", "Bu U", "Bd U"]},
        { label: "Right Thumb Down", targets: ["F D", "U D", "D D", "Bu D", "Bd D"]},
        { label: "Right Thumb Back", targets: ["F Bu", "U Bu", "D Bu", "Bu Bu", "Bd Bu", "F Bd", "U Bd", "D Bd", "Bu Bd", "Bd Bd"]},
        { label: ""},
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
        { label: ""},
        { label: "Normal", targets: ["F", "B", "R", "L", "U", "D"]},
        { label: "Wide", targets: ["f", "b", "r", "l", "u", "d"]},
    ]);

    document.getElementById("exportButton").addEventListener("click", () => {
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
            alert("Error exporting configuration: " + err.message);
        }
    });
    
    const importFile = document.getElementById("importFile");

    document.getElementById("importButton").addEventListener("click", () => {
        importFile.click();
    });

    importFile.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const config = JSON.parse(text);
            applyConfig(document.getElementById("costForm"), config);
            form.dispatchEvent(new Event("input", { bubbles: true }));
        } 
        catch (err) {
            alert("Error importing configuration: " + err.message);
        }

        importFile.value = "";
    });

    form.addEventListener("input", (e) => {
        if (e.target.matches('input[type="number"]')) {
            updateCostInputColors(form);
        }
        checkUnsavedChanges();
    });

    updateCostInputColors(form);
}

/**
 * @param {Object} imported 
 * @param {Object} defaults 
 * @returns 
 */
function migrateConfig(imported, defaults) {
    const output = structuredClone(defaults);
    for (const [key, value] of Object.entries(imported)) {
        if (key in defaults) {
            if (typeof value === "object") {
                for (const [sub, subVal] of Object.entries(value)) {
                    if (sub in defaults[key]) {
                        output[key][sub] = subVal;
                    }
                }
            } 
            else {
                output[key] = value;
            }
        }
    }
    return output;
}

/**
 * Adds bulk adjustments to the form
 * @param {HTMLFormElement} form 
 * @param {string} groupName 
 * @param {GroupControl[]} controls 
 * @returns 
 */
function addGroupControls(form, groupName, controls) {
    const groupDiv = document.querySelector(`[data-group="${groupName}"]`);
    if (!groupDiv) return;

    // Add a visual separator
    const separator = document.createElement("hr");
    separator.className = "group-separator";
    groupDiv.appendChild(separator);

    // Create a section header
    const header = document.createElement("p");
    header.textContent = "Adjustments";
    groupDiv.appendChild(header);

    // Create controls
    for (const ctrl of controls) {
        if(ctrl.label == "") {
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
        minus.dataset.delta = -0.5;

        const plus = document.createElement("button");
        plus.type = "button";
        plus.className = "btn-adjust";
        plus.textContent = "+";
        plus.dataset.group = groupName;
        plus.dataset.delta = 0.5;

        btnGroup.appendChild(minus);
        btnGroup.appendChild(plus);
        wrapper.appendChild(btnGroup);
        groupDiv.appendChild(wrapper);

        for(const btn of [minus, plus]) {
            btn.addEventListener('click', () => {
                const delta = parseFloat(btn.dataset.delta);
                const inputs = form.querySelectorAll(`[name^="${groupName}."]`);
                inputs.forEach(input => {
                    if(ctrl.targets.includes(input.name.split(".")[1])) {
                        const oldVal = parseFloat(input.value) || 0;
                        input.value = (oldVal + delta)
                    }
                })
                updateCostInputColors(form);
                form.dispatchEvent(new Event("input", { bubbles: true }));
            })
        }
    }

    const zeroButton = document.createElement("button");
    zeroButton.textContent = "Zero All";
    zeroButton.type = "button";
    zeroButton.className = "btn-zero";
    groupDiv.appendChild(zeroButton);

    zeroButton.addEventListener('click', () => {
        const inputs = form.querySelectorAll(`[name^="${groupName}."]`);
        inputs.forEach(input => {
            input.value = 0;
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
    const inputs = form.querySelectorAll('input[type="number"]');

    inputs.forEach(input => {
        const val = parseFloat(input.value);
        if(input.valueType == "additive")
            input.style.backgroundColor = costToColor(val, 5, -2);
        else if(input.valueType == "scalar")
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
            chrome.storage.local.set({ costConfig: config }, resolve);
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
                resolve(result.costConfig || null);
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
 * Save run options to storage
 * @param {Object} options 
 */
async function saveRunOptions(options) {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        await new Promise((resolve) => {
            chrome.storage.local.set({ runOptions: options }, resolve);
        });
    }
    localStorage.setItem("runOptions", JSON.stringify(options));
}

/**
 * Load run options from storage
 * @returns {Promise<Object>}
 */
async function loadRunOptions() {
    const defaults = ScrambleOptimizer.defaultRunOptions;
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        return new Promise((resolve) => {
            chrome.storage.local.get(["runOptions"], (result) => {
                resolve({ ...defaults, ...result.runOptions });
            });
        });
    }
    try {
        const stored = localStorage.getItem("runOptions");
        return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
    }
    catch {
        return defaults;
    }
}

/**
 * Get the cost configuration from the cost form
 * @param {*} form 
 * @param {CostConfig} initialConfig 
 * @returns {CostConfig}
 */
function collectCostConfig(form, initialConfig) {
    const newConfig = structuredClone(initialConfig);
    const formData = new FormData(form);

    for (const [fullKey, val] of formData.entries()) {
        const num = parseFloat(val);
        if (fullKey.includes(".")) {
            const [group, subkey] = fullKey.split(".");
            newConfig[group][subkey] = num;
        } 
        else {
            newConfig[fullKey] = num;
        }
    }

    return newConfig;
}

/**
 * Get all optimizer options from the document
 * @returns {RunOptions}
 */
function collectRunOptions() {
    const rawText = document.getElementById("scramble").value.trim();
    if (!rawText) {
        throw new Error("Please enter a scramble to analyze.");
    }
    const scramble = ScrambleOptimizer.parseScramble(rawText);
    const runOpts = collectRunOptionsValues();

    if (Number.isNaN(runOpts.depth) || Number.isNaN(runOpts.maxIterations)) {
        throw new Error("Depth and iterations must be numbers");
    }
    for(const move of scramble) {
        if(move.isRotation)
            throw new Error("Rotations not supported yet");
    }

    return { scramble, ...runOpts };
}

/**
 * Gather the current run options values from the DOM
 * @returns {Object}
 */
function collectRunOptionsValues() {
    const depth = parseFloat(document.getElementById("depth").value);
    const maxIterations = parseFloat(document.getElementById("iterations").value);
    const searchRotations = document.getElementById("searchRotations")?.checked ?? true;
    const searchStartingGrips = document.getElementById("searchStartingGrips")?.checked ?? true;
    const showGrips = document.getElementById("showGrips")?.checked ?? true;
    const pruneRotations = document.getElementById("pruneRotations")?.checked ?? true;
    const memoize = document.getElementById("memoize")?.checked ?? true;
    const wideReplaceDouble = document.getElementById("wideReplaceDouble")?.checked ?? true;

    return { depth, maxIterations, searchRotations, searchStartingGrips, showGrips, pruneRotations, memoize, wideReplaceDouble };
}

/**
 * Populate the DOM elements with the provided run options values
 * @param {Object} runOpts
 */
function applyRunOptionsValues(runOpts) {
    if (document.getElementById("depth")) document.getElementById("depth").value = runOpts.depth;
    if (document.getElementById("iterations")) document.getElementById("iterations").value = runOpts.maxIterations;
    if (document.getElementById("searchRotations")) document.getElementById("searchRotations").checked = runOpts.searchRotations;
    if (document.getElementById("searchStartingGrips")) document.getElementById("searchStartingGrips").checked = runOpts.searchStartingGrips;
    if (document.getElementById("showGrips")) document.getElementById("showGrips").checked = runOpts.showGrips;
    if (document.getElementById("pruneRotations")) document.getElementById("pruneRotations").checked = runOpts.pruneRotations;
    if (document.getElementById("memoize")) document.getElementById("memoize").checked = runOpts.memoize;
    if (document.getElementById("wideReplaceDouble")) document.getElementById("wideReplaceDouble").checked = runOpts.wideReplaceDouble;
}

/**
 * Populate the form with a given configuration
 * @param {HTMLFormElement} form 
 * @param {Object} config 
 */
function applyConfig(form, config) {
    for (const [groupName, groupValue] of Object.entries(config)) {
        if (typeof groupValue === "object") {
            for (const [key, val] of Object.entries(groupValue)) {
                const input = form.querySelector(`[name="${groupName}.${key}"]`);
                if (input) input.value = val;
            }
        } 
        else {
            const input = form.querySelector(`[name="${groupName}"]`);
            if (input) input.value = groupValue;
        }
    }
    updateCostInputColors(form);
}

/**
 * Show the amount of time taken to optimize
 * @param {number} time 
 */
export function drawSearchTime(time) {
    document.getElementById("searchTime").textContent = new Date(time).toISOString().slice(11, -1)
}