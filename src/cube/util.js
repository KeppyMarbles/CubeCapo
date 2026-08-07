import { Move } from "./move.js";
import { defaultColorScheme } from "./defaults.js";
/** @import { Orientation, StartingRotation, FaceStr, ColorSchemeConfig, RotationStr } from "../types.js" */

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