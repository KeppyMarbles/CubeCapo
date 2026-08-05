import { Move } from "./move.js";
import { defaultColorScheme } from "./defaults.js";
/** @import { Move } from "./move.js" */
/** @import { Orientation, Rotation, FaceStr, ColorSchemeConfig } from "../types.js" */

/**
 * Detects the cube size (2, 3, 4, 5, 6, 7) from a parsed Move array.
 * @param {Move[]} moves 
 * @returns {number} Cube size N
 */
export function detectCubeSize(moves) {
    if (!Array.isArray(moves) || moves.length === 0) return 3;

    let maxSlice = 1;
    let hasLeftDwBw = false;
    let has3LeftDwBw = false;
    let hasW = false;

    for (const move of moves) {
        if (!move || move.isRotation) continue;

        const slices = (move.isWide || move.sliceNum > 1) ? (move.sliceNum || 1) : 1;
        if (slices > maxSlice) maxSlice = slices;

        if (move.isWide || move.sliceNum > 1) {
            hasW = true;
            if (["L", "D", "B"].includes(move.alpha)) {
                hasLeftDwBw = true;
                if (slices >= 3) {
                    has3LeftDwBw = true;
                }
            }
        }
    }

    if (maxSlice >= 4) return maxSlice * 2 - 1;
    if (maxSlice === 3) return has3LeftDwBw ? 7 : 6;
    if (hasW) return hasLeftDwBw ? 5 : 4;

    // 2x2 vs 3x3 check: 2x2 scrambles have <= 12 moves and no wide moves
    if (moves.length <= 12) {
        return 2;
    }

    return 3;
}

/**
 * Returns top and front colors for a starting cube orientation.
 * @param {Orientation} orientation
 * @param {ColorSchemeConfig} [colorScheme=defaultColorScheme] - Color mapping for faces
 * @returns {{ topColor: string, frontColor: string }}
 */
export function getOrientationColors(orientation, colorScheme = defaultColorScheme) {
    if (!orientation) {
        return { topColor: "", frontColor: "" };
    }

    let state = { U: "U", D: "D", F: "F", B: "B", R: "R", L: "L" };
    for (const rot of [orientation.up, orientation.front]) {
        if (rot && Move.TRANSPOSITIONS[rot]) {
            const trans = Move.TRANSPOSITIONS[rot];
            const next = {};
            for (const [p, tag] of Object.entries(state)) {
                next[trans[p]] = tag;
            }
            state = next;
        }
    }

    return {
        topColor: colorScheme[state.U] || state.U || "",
        frontColor: colorScheme[state.F] || state.F || ""
    };
}

/**
 * Returns the rotation pair (up, front) required to restore a given cube orientation back to a target orientation (default standard U, F).
 * @param {Orientation} fromOrientation 
 * @param {Orientation} [toOrientation]
 * @returns {Rotation}
 */
export function getRestoringRotation(fromOrientation, toOrientation = { up: "U", front: "F" }) {
    if (!fromOrientation) {
        return { up: null, front: null };
    }
    const target = toOrientation || { up: "U", front: "F" };
    if (fromOrientation.up === target.up && fromOrientation.front === target.front) {
        return { up: null, front: null };
    }
    const topRotations = [null, "x", "x'", "x2", "z", "z'"];
    const frontRotations = [null, "y", "y'", "y2"];

    for (const topRot of topRotations) {
        for (const frontRot of frontRotations) {
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