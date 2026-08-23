import { ScrambleParser } from "../cube/parser.js";
import { costToColor } from "./stats.js";
import { defaultCostConfiguration, defaultFormatOptions, defaultRunOptions, defaultFingertricks, defaultColorScheme, strategyPresets } from "../cube/defaults.js";
import { Move } from "../cube/move.js";
import { ExecutionEvaluator, THUMB_POSITIONS, RIGHT_FINGERTRICKS, LEFT_FINGERTRICKS, mirrorRightFingertrick, mirrorLeftFingertrick } from "../cube/execution.js";
import { getElement, queryElementOptional, queryElements } from "./dom.js";
import { getStorageItem, setStorageItem, removeStorageItem } from "../storage.js";
/** @import { CostConfig, RunOptions, FormatOptions, ParseResult, NotationMode, TransitionConfig, ThumbPosition, MoveKey, RightFingertrick, LeftFingertrick, Fingertrick, FingerAction, ColorSchemeConfig } from "../types.js" */

/**
 * @typedef {Object} GroupControl
 * @property {string} label
 * @property {string[]} targets
 */

/**
 * Set up everything needed for the user to configure the optimizer
 * @param {(config: CostConfig, scramble: ParseResult, options: RunOptions, transitions: TransitionConfig) => Promise<void> | void} onSubmit
 * @param {() => void} [onFormatChange] Called whenever a format option changes
 */
export async function setupForm(onSubmit, onFormatChange) {
    let initialConfig = await loadCostConfig();
    if (initialConfig)
        initialConfig = migrateConfig(initialConfig, defaultCostConfiguration);
    else
        initialConfig = defaultCostConfiguration;

    let savedConfig = structuredClone(initialConfig);

    let initialTransitions = await loadTransitionConfig();
    if (!initialTransitions || !initialTransitions.right) {
        initialTransitions = defaultFingertricks;
    }
    let currentTransitions = structuredClone(initialTransitions);
    let savedTransitions = structuredClone(initialTransitions);

    /**
     * Set scramble input value, clean up pending storage, and trigger auto-submit
     * @param {string} text 
     */
    const applyScrambleAndSubmit = (text) => {
        const input = getElement("scramble", HTMLInputElement);
        input.value = text || "";

        if (text) {
            removeStorageItem("pendingScramble");
            setTimeout(() => {
                getElement("submitButton", HTMLButtonElement).click();
            }, 50);
        }
    };

    // Initial scramble population on setup
    const urlScramble = new URLSearchParams(window.location.search).get("scramble");
    if (urlScramble) {
        applyScrambleAndSubmit(urlScramble);
    } else {
        const pending = await getStorageItem("pendingScramble", "");
        applyScrambleAndSubmit(String(pending || ""));
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

    const form = getElement("costForm", HTMLFormElement);

    {
        /** @type {Record<string, string>} */
        const formAlias = {
            "regrip": "Base Regrip",
            "regripPerStep": "Regrip Per Step",
            //"double": "Double Move",
            "repeatPenalty": "Repeat Penalty",
            "perSliceFingertrick": "Slice Fingertrick",
            "handedness": "Dominant Hand",

            "x": "X Rotation",
            "y": "Y Rotation",
            "z": "Z Rotation",
        };

        /** @type {Record<string, string>} */
        const formTitles = {
            "regrip": "Cost of a full hand regrip (e.g. going from front thumb to back thumb)",
            "regripPerStep": "Multiplier on top of base regrip proportional to the distance moved (e.g. front thumb to up thumb is 1 step, but front thumb to back thumb is 2 steps)",
            //"double": "Cost of double move relative to a single move",
            "repeatPenalty": "Cost penalty for doing the same fingertrick twice in a row",
            "perSliceFingertrick": "If fingertrick cost should be applied for each effective slice",
            "handedness": "Choose dominant hand for fingertrick tiebreaks. Currently has minimal effect due to lack of slice moves. Change fingertrick costs to see more or less of a certain hand.",
            
            "x": "Cost to perform an X rotation",
            "y": "Cost to perform a Y rotation",
            "z": "Cost to perform a Z rotation",
        };

        /** @type {Record<string, string>} */
        const formTypes = {
            "perSliceFingertrick": "checkbox",
            "handedness": "select"
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

                if (formTypes[key] === "select") {
                    const select = document.createElement("select");
                    select.name = `${groupName}.${key}`;
                    const optRight = document.createElement("option");
                    optRight.value = "right";
                    optRight.textContent = "Right";
                    const optLeft = document.createElement("option");
                    optLeft.value = "left";
                    optLeft.textContent = "Left";
                    select.appendChild(optRight);
                    select.appendChild(optLeft);
                    select.value = String(val || "right");
                    label.appendChild(select);
                } else {
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
                }
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

    const colorScheme = /** @type {ColorSchemeConfig} */ (await loadOptions("colorScheme", defaultColorScheme));
    let savedColorScheme = structuredClone(colorScheme);
    applyColorSchemeValues(colorScheme);

    const transitionsTabEl = getElement("transitions", HTMLElement);
    renderTransitionsTab(transitionsTabEl, currentTransitions, () => checkUnsavedChanges());

    // Live update check for unsaved bar
    const checkUnsavedChanges = () => {
        const currentConfig = collectCostConfig(form, savedConfig);
        const currentRunOpts = collectRunOptionsValues();
        const currentColorScheme = collectColorSchemeValues();

        const configDiff = JSON.stringify(currentConfig) !== JSON.stringify(savedConfig);
        const optsDiff = JSON.stringify(currentRunOpts) !== JSON.stringify(savedRunOpts);
        const transDiff = JSON.stringify(currentTransitions) !== JSON.stringify(savedTransitions);
        const colorsDiff = JSON.stringify(currentColorScheme) !== JSON.stringify(savedColorScheme);

        const bar = getElement("unsavedChangesBar", HTMLElement);
        if (configDiff || optsDiff || transDiff || colorsDiff) {
            bar.classList.remove("hidden");
        } else {
            bar.classList.add("hidden");
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
        "searchRegrips",
        "injectXRotations",
        "injectZRotations",
        //"wideReplaceDouble",
        "partitionLength",
        //"cubeSize"
    ];
    computeInputIds.forEach(id => {
        const el = getElement(id, HTMLElement);
        el.addEventListener("input", checkUnsavedChanges);
        el.addEventListener("change", checkUnsavedChanges);
    });

    // Strategy Preset quick buttons
    const applyPreset = (/** @type {Partial<RunOptions>} */ preset) => {
        applyRunOptionsValues(preset);
        form.dispatchEvent(new Event("input", { bubbles: true }));
        checkUnsavedChanges();
    };

    getElement("presetFast", HTMLButtonElement).addEventListener("click", () => applyPreset(strategyPresets.fast));
    getElement("presetBalanced", HTMLButtonElement).addEventListener("click", () => applyPreset(strategyPresets.balanced));
    getElement("presetExhaustive", HTMLButtonElement).addEventListener("click", () => applyPreset(strategyPresets.exhaustive));

    // Attach change detection to color scheme settings
    const colorInputIds = [
        "colorSchemeU",
        "colorSchemeD",
        "colorSchemeF",
        "colorSchemeB",
        "colorSchemeR",
        "colorSchemeL"
    ];
    colorInputIds.forEach(id => {
        const el = getElement(id, HTMLInputElement);
        el.addEventListener("input", () => {
            checkUnsavedChanges();
            onFormatChange?.();
        });
        el.addEventListener("change", () => {
            checkUnsavedChanges();
            onFormatChange?.();
        });
    });

    // Format options: auto-save on change and trigger live update (no unsaved bar)
    const formatInputIds = [ 
        "showGrips", 
        //"showBoundaries", 
        "wedgeNotation", 
        "showOrientationColors", 
        "reorient"
    ];
    formatInputIds.forEach(id => {
        const el = getElement(id, HTMLElement);
        el.addEventListener("change", async () => {
            await saveOptions("formatOptions", collectFormatOptionsValues());
            onFormatChange?.();
        });
    });

    // Unsaved Changes Bar click listeners
    getElement("saveChangesButton", HTMLButtonElement).addEventListener("click", async () => {
        const config = collectCostConfig(form, savedConfig);
        await saveCostConfig(config);

        const runOptions = collectRunOptionsValues();
        await saveOptions("runOptions", runOptions);

        await saveOptions("transitionConfig", currentTransitions);

        const colorSchemeVals = collectColorSchemeValues();
        await saveOptions("colorScheme", colorSchemeVals);

        savedConfig = structuredClone(config);
        savedRunOpts = structuredClone(runOptions);
        savedTransitions = structuredClone(currentTransitions);
        savedColorScheme = structuredClone(colorSchemeVals);

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

    getElement("revertChangesButton", HTMLButtonElement).addEventListener("click", () => {
        applyConfig(form, savedConfig);
        applyRunOptionsValues(savedRunOpts);
        applyColorSchemeValues(savedColorScheme);
        currentTransitions = structuredClone(savedTransitions);
        renderTransitionsTab(transitionsTabEl, currentTransitions, () => checkUnsavedChanges());

        updateCostInputColors(form);
        checkUnsavedChanges();
        onFormatChange?.();
    });

    // Submit handler
    getElement("submitButton", HTMLButtonElement).addEventListener("click", async (e) => {
        e.preventDefault();
        const errEl = getElement("errorMessage", HTMLElement);
        errEl.textContent = "";
        try {
            const config = collectCostConfig(form, savedConfig);
            const scrambleInput = getElement("scramble", HTMLInputElement);
            const rawText = scrambleInput.value.trim();
            if (!rawText) {
                throw new Error("Please enter a scramble to analyze.");
            }
            const notationSelect = getElement("notationMode", HTMLSelectElement);
            const notationVal = notationSelect.value;
            const notation = /** @type {NotationMode} */ (notationVal ? notationVal : null);
            const parseResult = ScrambleParser.parse(rawText, { notation });
            const options = collectRunOptionsValues();
            await onSubmit(config, parseResult, options, currentTransitions);
        } 
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errEl.textContent = "Error: " + msg;
        }
    });

    getElement("resetDefaultButton", HTMLButtonElement).addEventListener("click", () => {
        applyConfig(form, defaultCostConfiguration);
        applyRunOptionsValues(defaultRunOptions);
        applyColorSchemeValues(defaultColorScheme);
        currentTransitions = structuredClone(defaultFingertricks);
        renderTransitionsTab(transitionsTabEl, currentTransitions, () => checkUnsavedChanges());
        form.dispatchEvent(new Event("input", { bubbles: true }));
        checkUnsavedChanges();
        onFormatChange?.();
    });

    // Level 1 Main Tabs (Move Execution vs Cost Penalties vs Search Strategy vs Format vs Profile)
    const MAIN_TAB_MAP = /** @type {const} */ ({
        execution: "mainTabExecution",
        penalties: "mainTabPenalties",
        strategy: "mainTabStrategy",
        format: "mainTabFormat",
        profile: "mainTabProfile",
    });

    queryElements(document, '.main-tab-btn', HTMLButtonElement).forEach(btn => {
        btn.addEventListener('click', () => {
            queryElements(document, '.main-tab-btn', HTMLButtonElement).forEach(b => b.classList.remove('active'));
            queryElements(document, '.main-tab-content', HTMLElement).forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const target = btn.dataset.mainTab;
            if (target && target in MAIN_TAB_MAP) {
                getElement(MAIN_TAB_MAP[/** @type {keyof typeof MAIN_TAB_MAP} */ (target)], HTMLElement).classList.add('active');
            }
        });
    });

    // Level 2 Cost Penalties Subtabs
    queryElements(document, '.subtab-btn[data-cost-tab]', HTMLButtonElement).forEach(btn => {
        btn.addEventListener('click', () => {
            queryElements(document, '.subtab-btn[data-cost-tab]', HTMLButtonElement).forEach(b => b.classList.remove('active'));
            queryElements(document, '.cost-tab-content', HTMLElement).forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const targetTab = btn.dataset.costTab;
            if (targetTab) {
                getElement(targetTab, HTMLElement).classList.add('active');
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

    getElement("exportButton", HTMLButtonElement).addEventListener("click", () => {
        try {
            const config = collectCostConfig(form, initialConfig);
            const colorSchemeVals = collectColorSchemeValues();
            const unifiedProfile = {
                costConfig: config,
                transitionConfig: currentTransitions,
                colorScheme: colorSchemeVals,
            };
            const json = JSON.stringify(unifiedProfile, null, 2);
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = "cube-capo-config.json";
            a.click();
            URL.revokeObjectURL(url);
        } 
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            alert("Error exporting configuration: " + msg);
        }
    });
    
    const importFile = getElement("importFile", HTMLInputElement);

    getElement("importButton", HTMLButtonElement).addEventListener("click", () => {
        importFile.click();
    });

    importFile.addEventListener("change", async (e) => {
        const target = e.target;
        if (!(target instanceof HTMLInputElement)) return;
        const file = target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== "object" || !parsed.costConfig || !parsed.transitionConfig) {
                throw new Error("Invalid configuration format. The file must contain both 'costConfig' and 'transitionConfig'.");
            }
            const costForm = getElement("costForm", HTMLFormElement);
            applyConfig(costForm, parsed.costConfig);
            currentTransitions = structuredClone(parsed.transitionConfig);
            applyColorSchemeValues(parsed.colorScheme);
            renderTransitionsTab(transitionsTabEl, currentTransitions, () => checkUnsavedChanges());
            form.dispatchEvent(new Event("input", { bubbles: true }));
            checkUnsavedChanges();
            onFormatChange?.();
        } 
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            alert("Error importing configuration: " + msg);
        }
        finally {
            importFile.value = "";
        }
    });

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
    await setStorageItem("costConfig", config);
}

/**
 * Get the cost configuration saved in storage
 * @returns {Promise<CostConfig | null>}
 */
async function loadCostConfig() {
    return getStorageItem("costConfig", null);
}

/**
 * Save an options object to storage under the given key
 * @param {string} key
 * @param {Object} options
 */
async function saveOptions(key, options) {
    await setStorageItem(key, options);
}

/**
 * Load an options object from storage, falling back to defaults
 * @template T
 * @param {string} key
 * @param {T} defaults
 * @returns {Promise<T>}
 */
async function loadOptions(key, defaults) {
    return getStorageItem(key, defaults);
}

/**
 * Get the cost configuration from the cost form
 * @param {HTMLFormElement} form 
 * @param {CostConfig} initialConfig 
 * @returns {CostConfig}
 */
function collectCostConfig(form, initialConfig) {
    const newConfig = /** @type {any} */ (structuredClone(initialConfig));

    for (const el of queryElements(form, "input[name], select[name]", HTMLElement)) {
        const fullKey = /** @type {HTMLInputElement | HTMLSelectElement} */ (el).name;
        let val;
        if (el instanceof HTMLInputElement && el.type === "checkbox") {
            val = el.checked;
        } else if (el instanceof HTMLSelectElement) {
            val = el.value;
        } else if (el instanceof HTMLInputElement) {
            val = parseFloat(el.value);
        }
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
        injectXRotations:  getElement("injectXRotations", HTMLInputElement).checked,
        injectZRotations: getElement("injectZRotations", HTMLInputElement).checked,
        searchRegrips: getElement("searchRegrips", HTMLInputElement).checked,
        partitionLength: parseFloat(getElement("partitionLength", HTMLInputElement).value),
        cubeSize: getElement("cubeSize", HTMLSelectElement).value ? Number(getElement("cubeSize", HTMLSelectElement).value) : null,
    };
}

/**
 * Gather the current color scheme values from the DOM
 * @returns {ColorSchemeConfig}
 */
export function collectColorSchemeValues() {
    return {
        U: getElement("colorSchemeU", HTMLInputElement).value.trim(),
        D: getElement("colorSchemeD", HTMLInputElement).value.trim(),
        F: getElement("colorSchemeF", HTMLInputElement).value.trim(),
        B: getElement("colorSchemeB", HTMLInputElement).value.trim(),
        R: getElement("colorSchemeR", HTMLInputElement).value.trim(),
        L: getElement("colorSchemeL", HTMLInputElement).value.trim(),
    };
}

/**
 * Populate the color scheme DOM elements with the provided values
 * @param {Partial<ColorSchemeConfig>} [colorScheme]
 */
function applyColorSchemeValues(colorScheme) {
    const scheme = { ...defaultColorScheme, ...(colorScheme || {}) };
    if (scheme.U !== undefined) getElement("colorSchemeU", HTMLInputElement).value = String(scheme.U);
    if (scheme.D !== undefined) getElement("colorSchemeD", HTMLInputElement).value = String(scheme.D);
    if (scheme.F !== undefined) getElement("colorSchemeF", HTMLInputElement).value = String(scheme.F);
    if (scheme.B !== undefined) getElement("colorSchemeB", HTMLInputElement).value = String(scheme.B);
    if (scheme.R !== undefined) getElement("colorSchemeR", HTMLInputElement).value = String(scheme.R);
    if (scheme.L !== undefined) getElement("colorSchemeL", HTMLInputElement).value = String(scheme.L);
}

/**
 * Gather the current format option values from the DOM
 * @returns {FormatOptions}
 */
export function collectFormatOptionsValues() {
    return {
        ...defaultFormatOptions,
        showGrips: getElement("showGrips", HTMLInputElement).checked,
        //showBoundaries: getElement("showBoundaries", HTMLInputElement).checked,
        wedgeNotation: getElement("wedgeNotation", HTMLInputElement).checked,
        showOrientationColors: getElement("showOrientationColors", HTMLInputElement).checked,
        reorient: getElement("reorient", HTMLInputElement).checked,
        colorScheme: collectColorSchemeValues(),
    };
}

/**
 * Populate the compute option DOM elements with the provided values
 * @param {Partial<RunOptions>} runOpts
 */
function applyRunOptionsValues(runOpts) {
    if (runOpts.depth !== undefined) getElement("depth", HTMLInputElement).value = String(runOpts.depth);
    if (runOpts.maxIterations !== undefined) getElement("iterations", HTMLInputElement).value = String(runOpts.maxIterations);
    if (runOpts.maxRegripBranches !== undefined) getElement("maxRegripBranches", HTMLInputElement).value = String(runOpts.maxRegripBranches);
    if (runOpts.searchRotations !== undefined) getElement("searchRotations", HTMLInputElement).checked = Boolean(runOpts.searchRotations);
    if (runOpts.pruneRotations !== undefined) getElement("pruneRotations", HTMLInputElement).checked = Boolean(runOpts.pruneRotations);
    if (runOpts.memoize !== undefined) getElement("memoize", HTMLInputElement).checked = Boolean(runOpts.memoize);
    if (runOpts.wideReplace !== undefined) getElement("wideReplace", HTMLInputElement).checked = Boolean(runOpts.wideReplace);
    if (runOpts.injectXRotations !== undefined) getElement("injectXRotations", HTMLInputElement).checked = Boolean(runOpts.injectXRotations);
    if (runOpts.injectZRotations !== undefined) getElement("injectZRotations", HTMLInputElement).checked = Boolean(runOpts.injectZRotations);
    if (runOpts.searchRegrips !== undefined) getElement("searchRegrips", HTMLInputElement).checked = Boolean(runOpts.searchRegrips);
    if (runOpts.partitionLength !== undefined) getElement("partitionLength", HTMLInputElement).value = String(runOpts.partitionLength);
    if (runOpts.cubeSize !== undefined) getElement("cubeSize", HTMLSelectElement).value = String(runOpts.cubeSize);
}

/**
 * Populate the format option DOM elements with the provided values
 * @param {FormatOptions} formatOpts
 */
function applyFormatOptionsValues(formatOpts) {
    const opts = { ...defaultFormatOptions, ...formatOpts };

    getElement("showGrips", HTMLInputElement).checked = Boolean(opts.showGrips ?? defaultFormatOptions.showGrips);
    //getElement("showBoundaries", HTMLInputElement).checked = Boolean(opts.showBoundaries ?? defaultFormatOptions.showBoundaries);
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
                const el = queryElementOptional(form, `[name="${groupName}.${key}"]`, HTMLElement);
                if (!el) continue;
                if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = Boolean(val);
                else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = String(val);
            }
        } 
        else {
            const el = queryElementOptional(form, `[name="${groupName}"]`, HTMLElement);
            if (!el) continue;
            if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = Boolean(groupValue);
            else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = String(groupValue);
        }
    }
    updateCostInputColors(form);
}

/**
 * Show the amount of time taken to optimize
 * @param {number} time 
 */
export function drawSearchTime(time) {
    const el = getElement("searchTime", HTMLElement);
    el.textContent = new Date(time).toISOString().slice(11, -1);
}

/**
 * Canonical Symmetrical Move Pairs for Right and Left hands (all 36 moves)
 * @type {readonly { r: MoveKey, l: MoveKey }[]}
 */
const CANONICAL_MOVE_PAIRS = Object.freeze(
    ["R", "L", "U", "D", "F", "B"].flatMap(face =>
        Move.MODIFIERS.map(mod => {
            const r = /** @type {MoveKey} */ (`${face}${mod}`);
            const l = Move.MIRROR_MOVE_MAP[r] ?? r;
            return { r, l };
        })
    )
);
/**
 * Renders the Transitions tab in the configuration form
 * @param {HTMLElement} container
 * @param {TransitionConfig} currentTransitions
 * @param {() => void} onTransitionChange
 */
function renderTransitionsTab(container, currentTransitions, onTransitionChange) {
    container.replaceChildren();

    let activePosition = /** @type {ThumbPosition} */ ("F");

    const subtabBar = document.createElement("div");
    subtabBar.className = "subtab-buttons";

    const contentContainer = document.createElement("div");
    contentContainer.className = "transition-container";

    const renderCurrentGrid = () => {
        contentContainer.replaceChildren();

        const headerRow = document.createElement("div");
        headerRow.className = "transition-header-row";
        for (const title of ["Move", "🤚 Left Hand", "Link", "✋ Right Hand", "Move"]) {
            const span = document.createElement("span");
            span.textContent = title;
            headerRow.appendChild(span);
        }
        contentContainer.appendChild(headerRow);

        const grid = document.createElement("div");
        grid.className = "transition-grid";

        for (const { r: rMove, l: lMove } of CANONICAL_MOVE_PAIRS) {
            const rFt = currentTransitions.right[activePosition] ? currentTransitions.right[activePosition][rMove] : null;
            const leftSub = currentTransitions.left ? currentTransitions.left[activePosition] : undefined;
            const isLinked = !leftSub || leftSub[lMove] === undefined;

            const resolvedLFt = isLinked 
                ? (rFt ? mirrorRightFingertrick(rFt) : null)
                : (leftSub ? leftSub[lMove] : null);

            const row = document.createElement("div");
            row.className = "transition-row";

            // Left Move Label
            const lLabel = document.createElement("span");
            lLabel.className = "transition-move-label";
            lLabel.textContent = lMove;

            // Left Hand Select
            const lSelect = document.createElement("select");
            if (isLinked) lSelect.classList.add("select-mirrored");
            const lNoneOpt = document.createElement("option");
            lNoneOpt.value = "";
            lNoneOpt.textContent = "None";
            lSelect.appendChild(lNoneOpt);

            for (const ft of LEFT_FINGERTRICKS) {
                const opt = document.createElement("option");
                opt.value = ft;
                opt.textContent = ft;
                lSelect.appendChild(opt);
            }
            lSelect.value = resolvedLFt || "";

            // Link Toggle Button
            const linkBtn = document.createElement("button");
            linkBtn.type = "button";
            linkBtn.className = `btn-link-toggle ${isLinked ? "linked" : "unlinked"}`;
            linkBtn.title = isLinked ? "Linked to Right Hand (Mirrored). Click to unlink." : "Custom Left Hand Override. Click to relink.";

            const iconSpan = document.createElement("span");
            iconSpan.className = `icon-svg ${isLinked ? "icon-link" : "icon-unlink"}`;
            linkBtn.appendChild(iconSpan);

            // Right Hand Select
            const rSelect = document.createElement("select");
            const rNoneOpt = document.createElement("option");
            rNoneOpt.value = "";
            rNoneOpt.textContent = "None";
            rSelect.appendChild(rNoneOpt);

            for (const ft of RIGHT_FINGERTRICKS) {
                const opt = document.createElement("option");
                opt.value = ft;
                opt.textContent = ft;
                rSelect.appendChild(opt);
            }
            rSelect.value = rFt || "";

            // Right Move Label
            const rLabel = document.createElement("span");
            rLabel.className = "transition-move-label";
            rLabel.textContent = rMove;

            // Event Listeners
            rSelect.addEventListener("change", () => {
                const newRFt = /** @type {RightFingertrick | null} */ (rSelect.value || null);
                if (!currentTransitions.right[activePosition]) {
                    currentTransitions.right[activePosition] = /** @type {any} */ ({});
                }
                currentTransitions.right[activePosition][rMove] = newRFt;

                // If linked, also update Left select
                const leftSub = currentTransitions.left ? currentTransitions.left[activePosition] : undefined;
                const isCurrentlyLinked = !leftSub || leftSub[lMove] === undefined;
                if (isCurrentlyLinked) {
                    const mirrored = newRFt ? mirrorRightFingertrick(newRFt) : null;
                    lSelect.value = mirrored || "";
                }

                onTransitionChange();
            });

            lSelect.addEventListener("change", () => {
                const newLFt = /** @type {LeftFingertrick | null} */ (lSelect.value || null);
                const leftSub = currentTransitions.left ? currentTransitions.left[activePosition] : undefined;
                const isCurrentlyLinked = !leftSub || leftSub[lMove] === undefined;

                if (isCurrentlyLinked) {
                    // Symmetrical link active: update right hand with mirrored value
                    const newRFt = newLFt ? mirrorLeftFingertrick(newLFt) : null;
                    if (!currentTransitions.right[activePosition]) {
                        currentTransitions.right[activePosition] = /** @type {any} */ ({});
                    }
                    currentTransitions.right[activePosition][rMove] = newRFt;
                    rSelect.value = newRFt || "";
                } else {
                    // Unlinked: update custom left override
                    if (!currentTransitions.left) currentTransitions.left = {};
                    let targetSub = currentTransitions.left[activePosition];
                    if (!targetSub) {
                        targetSub = {};
                        currentTransitions.left[activePosition] = targetSub;
                    }
                    targetSub[lMove] = newLFt;
                }

                onTransitionChange();
            });

            linkBtn.addEventListener("click", () => {
                const leftSub = currentTransitions.left ? currentTransitions.left[activePosition] : undefined;
                const isCurrentlyLinked = !leftSub || leftSub[lMove] === undefined;
                if (isCurrentlyLinked) {
                    // Unlink: store current value explicitly
                    if (!currentTransitions.left) currentTransitions.left = {};
                    let targetSub = currentTransitions.left[activePosition];
                    if (!targetSub) {
                        targetSub = {};
                        currentTransitions.left[activePosition] = targetSub;
                    }
                    targetSub[lMove] = /** @type {LeftFingertrick | null} */ (lSelect.value || null);

                    iconSpan.className = "icon-svg icon-unlink";
                    linkBtn.className = "btn-link-toggle unlinked";
                    linkBtn.title = "Custom Left Hand Override. Click to relink.";
                    lSelect.classList.remove("select-mirrored");
                } else {
                    // Relink: delete override
                    const leftSub = currentTransitions.left ? currentTransitions.left[activePosition] : undefined;
                    if (leftSub) {
                        delete leftSub[lMove];
                    }
                    const rightSub = currentTransitions.right[activePosition];
                    const currentRightVal = rightSub ? rightSub[rMove] : null;
                    const mirrored = currentRightVal ? mirrorRightFingertrick(currentRightVal) : null;
                    lSelect.value = mirrored || "";

                    iconSpan.className = "icon-svg icon-link";
                    linkBtn.className = "btn-link-toggle linked";
                    linkBtn.title = "Linked to Right Hand (Mirrored). Click to unlink.";
                    lSelect.classList.add("select-mirrored");
                }
                onTransitionChange();
            });

            row.appendChild(lLabel);
            row.appendChild(lSelect);
            row.appendChild(linkBtn);
            row.appendChild(rSelect);
            row.appendChild(rLabel);

            grid.appendChild(row);
        }

        contentContainer.appendChild(grid);
    };

    THUMB_POSITIONS.forEach(pos => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `subtab-btn ${pos === activePosition ? "active" : ""}`;
        btn.textContent = pos;
        btn.addEventListener("click", () => {
            activePosition = pos;
            queryElements(subtabBar, ".subtab-btn", HTMLButtonElement).forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            renderCurrentGrid();
        });
        subtabBar.appendChild(btn);
    });

    container.appendChild(subtabBar);
    container.appendChild(contentContainer);
    renderCurrentGrid();
}

/**
 * Get the transition configuration saved in storage
 * @returns {Promise<TransitionConfig | null>}
 */
async function loadTransitionConfig() {
    return getStorageItem("transitionConfig", null);
}