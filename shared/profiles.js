import { defaultCostConfiguration, defaultSearchOptions, defaultFormatOptions, defaultFingertricks } from "./defaults.js";
import { getStorageItem, setStorageItem } from "./storage.js";
/** @import { CostConfig, TransitionConfig } from "./cube/evaluator.js" */
/** @import { SearchOptions, FormatOptions } from "./cube/optimizer.js" */

/**
 * @typedef {Object} Profile
 * @property {CostConfig} costConfig
 * @property {SearchOptions} searchOptions
 * @property {FormatOptions} formatOptions
 * @property {TransitionConfig} transitionConfig
 */

/**
 * The differences between a profile and its base. Everything not listed here follows the base.
 * @typedef {Object} Overrides
 * @property {Record<string, unknown>} set Leaf values that differ from the base, keyed by path
 * @property {string[]} unset Paths of leaf values that the base has and this profile doesn't
 */

/**
 * A profile as saved: only what it changes about its base profile
 * @typedef {Object} StoredProfile
 * @property {string | null} base Name of the profile this one inherits from, or null for a standalone profile that stores all of its settings
 * @property {Overrides} overrides
 */

/** @typedef {Record<string, StoredProfile>} ProfileMap */

export const DEFAULT_PROFILE_NAME = "Default";
export const CUSTOM_PROFILE_NAME = "Custom";

const PATH_SEPARATOR = ".";

/** Fingertricks are sparse (an unset left hand entry means it mirrors the right), so their paths may not exist in the base */
const SPARSE_SECTION = "transitionConfig";

/**
 * A fresh copy of the built-in default profile
 * @returns {Profile}
 */
export function createDefaultProfile() {
    return structuredClone({
        costConfig: defaultCostConfiguration,
        searchOptions: defaultSearchOptions,
        formatOptions: defaultFormatOptions,
        transitionConfig: defaultFingertricks,
    });
}

/**
 * A profile that follows its base entirely
 * @param {string} base
 * @returns {StoredProfile}
 */
export function createBranch(base) {
    return { base, overrides: { set: {}, unset: [] } };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Collect every leaf value (anything that isn't a plain object) of a profile, keyed by path
 * @param {unknown} value
 * @param {string} path
 * @param {Map<string, unknown>} leaves
 * @returns {Map<string, unknown>}
 */
function collectLeaves(value, path = "", leaves = new Map()) {
    if (!isPlainObject(value)) {
        leaves.set(path, value);
        return leaves;
    }
    for (const [key, child] of Object.entries(value)) {
        if (child !== undefined)
            collectLeaves(child, path ? path + PATH_SEPARATOR + key : key, leaves);
    }
    return leaves;
}

/**
 * Whether a path is overridden
 * @param {Overrides} overrides
 * @param {string} path
 * @returns {boolean}
 */
export function isOverridden(overrides, path) {
    return path in overrides.set || overrides.unset.includes(path);
}

/**
 * Work out what a profile changes about a base profile
 * @param {Profile} base
 * @param {Profile} profile
 * @returns {Overrides}
 */
export function diffProfiles(base, profile) {
    const baseLeaves = collectLeaves(base);
    const leaves = collectLeaves(profile);
    /** @type {Overrides} */
    const overrides = { set: {}, unset: [] };

    for (const [path, value] of leaves) {
        if (!baseLeaves.has(path) || JSON.stringify(baseLeaves.get(path)) !== JSON.stringify(value))
            overrides.set[path] = value;
    }
    for (const path of baseLeaves.keys()) {
        if (!leaves.has(path))
            overrides.unset.push(path);
    }
    return overrides;
}

/**
 * Whether a base value can be replaced by an override (null stands in for "no fingertrick")
 * @param {unknown} current
 * @param {unknown} value
 */
function isSameKind(current, value) {
    return current === null || value === null || typeof current === typeof value;
}

/**
 * Apply overrides on top of a base profile. Overrides the base no longer has a place for are ignored.
 * @param {Profile} base
 * @param {Overrides} overrides
 * @returns {Profile}
 */
function applyOverrides(base, overrides) {
    const profile = structuredClone(base);
    /** @type {Record<string, any>} */
    const root = profile;

    for (const [path, value] of Object.entries(overrides.set)) {
        const keys = path.split(PATH_SEPARATOR);
        const leafKey = keys[keys.length - 1];
        const sparse = keys[0] === SPARSE_SECTION;

        let node = root;
        let reachable = true;
        for (const key of keys.slice(0, -1)) {
            if (!isPlainObject(node[key])) {
                if (!sparse) {
                    reachable = false;
                    break;
                }
                node[key] = {};
            }
            node = node[key];
        }
        if (reachable && (sparse || (leafKey in node && isSameKind(node[leafKey], value))))
            node[leafKey] = value;
    }

    for (const path of overrides.unset) {
        const keys = path.split(PATH_SEPARATOR);
        let node = root;
        for (const key of keys.slice(0, -1)) {
            if (!isPlainObject(node[key])) break;
            node = node[key];
        }
        delete node[keys[keys.length - 1]];
    }

    return profile;
}

/**
 * Get the full settings of a profile, with everything inherited from its bases filled in
 * @param {string} name
 * @param {ProfileMap} profiles
 * @param {Set<string>} [visited] Used to catch circular bases
 * @returns {Profile}
 */
export function resolveProfile(name, profiles, visited = new Set()) {
    if (name === DEFAULT_PROFILE_NAME)
        return createDefaultProfile();

    const stored = profiles[name];
    if (!stored || visited.has(name))
        throw new Error(`Profile "${name}" doesn't exist or has a circular base.`);
    visited.add(name);
    // A standalone profile only borrows the shape of the default for settings added after it was saved
    const base = stored.base === null ? createDefaultProfile() : resolveProfile(stored.base, profiles, visited);
    return applyOverrides(base, stored.overrides);
}

/**
 * Save the settings of a profile as the changes from the given base, or in full if it has none
 * @param {string | null} base
 * @param {Profile} profile
 * @param {ProfileMap} profiles Used to look up the base
 * @returns {StoredProfile}
 */
export function createStoredProfile(base, profile, profiles) {
    if (base !== null)
        return { base, overrides: diffProfiles(resolveProfile(base, profiles), profile) };

    const template = collectLeaves(createDefaultProfile());
    const leaves = collectLeaves(profile);
    return {
        base,
        overrides: {
            set: Object.fromEntries(leaves),
            unset: [...template.keys()].filter(path => !leaves.has(path)),
        },
    };
}

/**
 * Remove a profile. Profiles based on it are moved to its base, keeping their settings.
 * @param {string} name
 * @param {ProfileMap} profiles
 * @returns {string[]} The profiles that were moved to a new base
 */
export function removeProfile(name, profiles) {
    const removedBase = profiles[name].base;
    const moved = Object.keys(profiles).filter(key => profiles[key].base === name);
    for (const key of moved) {
        const resolved = resolveProfile(key, profiles);
        profiles[key] = createStoredProfile(removedBase, resolved, profiles);
    }
    delete profiles[name];
    return moved;
}

/**
 * Get the user's saved profiles (the built-in default is not stored).
 * The first time this is called there is a Custom profile to start from.
 * @returns {Promise<ProfileMap>}
 */
export async function loadProfiles() {
    const profiles = await getStorageItem("profiles", null);
    if (profiles)
        return profiles;

    const initial = { [CUSTOM_PROFILE_NAME]: createBranch(DEFAULT_PROFILE_NAME) };
    await saveProfiles(initial);
    return initial;
}

/**
 * @param {ProfileMap} profiles
 */
export async function saveProfiles(profiles) {
    await setStorageItem("profiles", profiles);
}

/**
 * Get the name of the profile the current settings belong to
 * @returns {Promise<string>}
 */
export async function loadActiveProfileName() {
    return getStorageItem("activeProfile", DEFAULT_PROFILE_NAME);
}

/**
 * @param {string} name
 */
export async function saveActiveProfileName(name) {
    await setStorageItem("activeProfile", name);
}

/**
 * Write a profile to the active settings storage, which is what the optimizer and extension read
 * @param {Profile} profile
 */
export async function persistActiveProfile(profile) {
    await setStorageItem("costConfig", profile.costConfig);
    await setStorageItem("searchOptions", profile.searchOptions);
    await setStorageItem("transitionConfig", profile.transitionConfig);
    await setStorageItem("formatOptions", profile.formatOptions);
}

/**
 * Find an unused profile name based on the given one
 * @param {string} base
 * @param {ProfileMap} profiles
 * @returns {string}
 */
export function uniqueProfileName(base, profiles) {
    const taken = (/** @type {string} */ name) => name === DEFAULT_PROFILE_NAME || name in profiles;
    if (!taken(base)) return base;
    let n = 2;
    while (taken(`${base} ${n}`)) n++;
    return `${base} ${n}`;
}

/**
 * Copy the values of an imported cost configuration that match the shape and types of the defaults
 * @param {Record<string, any>} imported
 * @param {Record<string, any>} defaults
 * @returns {CostConfig}
 */
export function migrateConfig(imported, defaults) {
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
 * Build a profile from the contents of an exported profile file
 * @param {any} parsed The parsed JSON
 * @param {string} fallbackName Used if the file doesn't name the profile
 * @returns {{ name: string, profile: Profile }}
 */
export function parseImportedProfile(parsed, fallbackName) {
    if (!parsed || typeof parsed !== "object" || !parsed.costConfig || !parsed.transitionConfig) {
        throw new Error("Invalid configuration format. The file must contain both 'costConfig' and 'transitionConfig'.");
    }
    if (!parsed.transitionConfig.right) {
        throw new Error("Invalid 'transitionConfig'.");
    }
    const name = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : fallbackName;
    return {
        name,
        profile: {
            costConfig: migrateConfig(parsed.costConfig, defaultCostConfiguration),
            searchOptions: { ...defaultSearchOptions, ...parsed.searchOptions },
            formatOptions: { ...defaultFormatOptions, ...parsed.formatOptions },
            transitionConfig: parsed.transitionConfig,
        },
    };
}
