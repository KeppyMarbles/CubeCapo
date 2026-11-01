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

/** @typedef {Record<string, Profile>} ProfileMap */

export const DEFAULT_PROFILE_NAME = "Default";

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
 * Get the user's saved profiles (the built-in default is not stored)
 * @returns {Promise<ProfileMap>}
 */
export async function loadProfiles() {
    return getStorageItem("profiles", {});
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
