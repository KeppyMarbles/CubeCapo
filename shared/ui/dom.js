/**
 * DOM utility helpers for type-safe element retrieval with runtime verification
 */

/**
 * Retrieves a required DOM element by ID and asserts it is an instance of the given constructor.
 * Throws an error if missing or matching wrong type.
 * @template {HTMLElement} T
 * @param {string} id 
 * @param {new (...args: any[]) => T} constructor 
 * @returns {T}
 */
export function getElement(id, constructor) {
    const el = document.getElementById(id);
    if (!el) {
        throw new Error(`Required element #${id} not found in DOM`);
    }
    if (!(el instanceof constructor)) {
        throw new Error(`Element #${id} is an instance of ${el.constructor.name}, expected ${constructor.name}`);
    }
    return el;
}

/**
 * Retrieves an optional DOM element by ID. Returns null if missing, logs warning if wrong type.
 * @template {HTMLElement} T
 * @param {string} id 
 * @param {new (...args: any[]) => T} constructor 
 * @returns {T | null}
 */
export function getOptionalElement(id, constructor) {
    const el = document.getElementById(id);
    if (!el) return null;
    if (!(el instanceof constructor)) {
        console.warn(`Element #${id} is an instance of ${el.constructor.name}, expected ${constructor.name}`);
        return null;
    }
    return el;
}

/**
 * Queries a required DOM element within a parent container and asserts its type constructor.
 * @template {HTMLElement} T
 * @param {ParentNode} parent 
 * @param {string} selector 
 * @param {new (...args: any[]) => T} constructor 
 * @returns {T}
 */
export function queryElement(parent, selector, constructor) {
    const el = parent.querySelector(selector);
    if (!el) {
        throw new Error(`Required element matching "${selector}" not found in DOM`);
    }
    if (!(el instanceof constructor)) {
        throw new Error(`Element matching "${selector}" is an instance of ${el.constructor.name}, expected ${constructor.name}`);
    }
    return el;
}

/**
 * Queries an optional DOM element within a parent container and asserts its type constructor.
 * @template {HTMLElement} T
 * @param {ParentNode} parent 
 * @param {string} selector 
 * @param {new (...args: any[]) => T} constructor 
 * @returns {T | null}
 */
export function queryElementOptional(parent, selector, constructor) {
    const el = parent.querySelector(selector);
    if (!el) return null;
    if (!(el instanceof constructor)) {
        console.warn(`Element matching "${selector}" is an instance of ${constructor.name}`);
        return null;
    }
    return el;
}

/**
 * Queries all DOM elements matching selector within a parent container and filters by constructor type.
 * @template {HTMLElement} T
 * @param {ParentNode} parent 
 * @param {string} selector 
 * @param {new (...args: any[]) => T} constructor 
 * @returns {T[]}
 */
export function queryElements(parent, selector, constructor) {
    const list = parent.querySelectorAll(selector);
    /** @type {T[]} */
    const result = [];
    for (const el of list) {
        if (el instanceof constructor) {
            result.push(el);
        } else {
            console.warn(`Element matching "${selector}" is an instance of ${el.constructor.name}, expected ${constructor.name}`);
        }
    }
    return result;
}
