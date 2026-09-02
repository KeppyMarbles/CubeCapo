import { Move } from "./move.js";
import { defaultColorScheme } from "../defaults.js";
/** @import { FaceStr, RotationStr } from "./move.js" */

/** 
 * @typedef {Object} Orientation
 * @property {FaceStr} up The face on top
 * @property {FaceStr} front The face in front
 */

/** 
 * @typedef {Object} StartingRotation
 * @property {RotationStr | null} up The top rotation
 * @property {RotationStr | null} front The front rotation
 */

/**
 * @typedef {Record<FaceStr, string>} ColorSchemeConfig
 */

/**
 * Detects the cube size (2, 3, 4, 5, 6, 7, ...) from a parsed Move array.
 * @param {Move[]} moves 
 * @returns {number} Cube size N
 */
export function detectCubeSize(moves) {
    if (!Array.isArray(moves) || moves.length === 0) return 3;

    let maxSlice = 1;
    let hasMaxSliceLDB = false;
    let hasW = false;

    for (const move of moves) {
        if (!move || move.isRotation) continue;

        if (move.sliceNum > 1) {
            hasW = true;
            const isLDB = ["L", "D", "B"].includes(move.alpha);

            if (move.sliceNum > maxSlice) {
                maxSlice = move.sliceNum;
                hasMaxSliceLDB = isLDB;
            } else if (move.sliceNum === maxSlice && isLDB) {
                hasMaxSliceLDB = true;
            }
        }
    }

    if (hasW && maxSlice >= 2) {
        return hasMaxSliceLDB ? (maxSlice * 2 + 1) : (maxSlice * 2);
    }

    // 2x2 vs 3x3 check: 2x2 scrambles have <= 12 moves and no wide moves
    if (moves.length <= 12) {
        return 2;
    }

    return 3;
}

/**
 * Returns top and front colors for a starting cube rotation.
 * @param {StartingRotation} [rotation]
 * @param {ColorSchemeConfig} [colorScheme=defaultColorScheme] - Color mapping for faces
 * @returns {{ topColor: string, frontColor: string }}
 */
export function getOrientationColors(rotation, colorScheme = defaultColorScheme) {
    if (!rotation) {
        return { topColor: "", frontColor: "" };
    }

    /** @type {Record<string, string>} */
    let state = { U: "U", D: "D", F: "F", B: "B", R: "R", L: "L" };
    const transMap = /** @type {Record<string, Record<string, string>>} */ (/** @type {unknown} */ (Move.TRANSPOSITIONS));

    for (const rot of [rotation.up, rotation.front]) {
        if (rot && transMap[rot]) {
            const trans = transMap[rot];
            /** @type {Record<string, string>} */
            const next = {};
            for (const [p, tag] of Object.entries(state)) {
                if (trans[p]) {
                    next[trans[p]] = tag;
                }
            }
            state = next;
        }
    }

    const uFace = /** @type {FaceStr} */ (state.U);
    const fFace = /** @type {FaceStr} */ (state.F);

    return {
        topColor: (uFace && colorScheme[uFace]) || state.U || "",
        frontColor: (fFace && colorScheme[fFace]) || state.F || ""
    };
}

/**
 * Returns the rotation pair (up, front) required to restore a given cube orientation back to a target orientation (default standard U, F).
 * @param {Orientation} fromOrientation 
 * @param {Orientation} [toOrientation]
 * @returns {StartingRotation}
 */
export function getRestoringRotation(fromOrientation, toOrientation = { up: "U", front: "F" }) {
    if (!fromOrientation) {
        return { up: null, front: null };
    }
    const target = toOrientation || { up: "U", front: "F" };
    if (fromOrientation.up === target.up && fromOrientation.front === target.front) {
        return { up: null, front: null };
    }
    for (const topRot of Move.TOP_ROTATIONS) {
        for (const frontRot of Move.FRONT_ROTATIONS) {
            const test = { ...fromOrientation };
            if (topRot) Move.transposeOrientation(test, topRot);
            if (frontRot) Move.transposeOrientation(test, frontRot);
            if (test.up === target.up && test.front === target.front) {
                return { up: topRot, front: frontRot };
            }
        }
    }
    return { up: null, front: null };
}

/**
 * Calculates the resulting orientation after applying a sequence of moves (including rotations and wide moves)
 * starting from an initial orientation.
 * @param {readonly Move[]} moves 
 * @param {Orientation} [initialOrientation={ up: "U", front: "F" }] 
 * @returns {Orientation}
 */
export function getFinalOrientation(moves, initialOrientation = { up: "U", front: "F" }) {
    const orientation = { ...initialOrientation };
    if (!Array.isArray(moves)) return orientation;
    for (let i = 0; i < moves.length; i++) {
        const move = moves[i];
        if (!move) continue;
        const { rotation } = move.decompose();
        if (rotation) {
            Move.transposeOrientation(orientation, rotation);
        }
    }
    return orientation;
}

/**
 * Flattens and normalizes a sequence of moves by decomposing slice and wide moves
 * and propagating mid-scramble rotations into pure face moves.
 * @param {readonly Move[]} moves Sequence of moves to normalize
 * @returns {Move[]} Normalized, rotation-free sequence of pure face moves
 */
export function normalizeScramble(moves) {
    if (!Array.isArray(moves) || moves.length === 0) return [];

    /** @type {Move[]} */
    const normalized = [];
    const decompContainer = { faceMoves: /** @type {Move[]} */ ([]), rotation: /** @type {RotationStr | null} */ (null) };

    for (let i = moves.length - 1; i >= 0; i--) {
        const move = moves[i];
        if (!move) continue;
        const { faceMoves, rotation } = move.decompose(decompContainer);
        if (rotation) {
            for (let j = 0; j < normalized.length; j++) {
                normalized[j].transposeInverse(rotation);
            }
        }
        if (faceMoves) {
            for (let k = faceMoves.length - 1; k >= 0; k--) {
                normalized.unshift(faceMoves[k]);
            }
        }
    }

    return normalized;
}