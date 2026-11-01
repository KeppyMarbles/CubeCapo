import { Move, ALPHA_INDEXES } from "./move.js";
/** @import { Orientation } from "./util.js" */
/** @import { RotationStr, FacePermutation } from "./move.js" */

// Lookup tables that let the optimizer's search track cube rotations using small integers.

/** @type {readonly RotationStr[]} */
export const ROTATION_KEYS = Object.freeze(/** @type {RotationStr[]} */ (Object.keys(Move.TRANSPOSITIONS)));
export const ROTATION_COUNT = ROTATION_KEYS.length;

/** @type {Readonly<Record<string, number>>} */
export const ROTATION_INDEXES = Object.freeze(Object.fromEntries(ROTATION_KEYS.map((key, i) => [key, i])));

/**
 * Finds every state reachable from a starting state by rotations, and the transition table between them.
 * @template T
 * @param {T} start Starting state; always gets index 0
 * @param {(state: T, rotKey: RotationStr) => T} rotate Returns the state after a rotation
 * @param {(state: T) => string} identify Returns a string that is equal for equal states
 * @returns {{ states: T[], after: Int8Array }} Every state, and the index of the state after rotation r from state s at s * ROTATION_COUNT + r
 */
function enumerateStates(start, rotate, identify) {
    const states = [start];
    const indexes = new Map([[identify(start), 0]]);
    /** @type {number[]} */
    const after = [];
    for (let s = 0; s < states.length; s++) {
        for (const rotKey of ROTATION_KEYS) {
            const next = rotate(states[s], rotKey);
            const id = identify(next);
            let index = indexes.get(id);
            if (index === undefined) {
                index = states.length;
                states.push(next);
                indexes.set(id, index);
            }
            after[s * ROTATION_COUNT + ROTATION_INDEXES[rotKey]] = index;
        }
    }
    return { states, after: Int8Array.from(after) };
}

/** @type {(orientation: Orientation) => string} */
const identifyOrientation = (orientation) => `${orientation.up}${orientation.front}`;

const orientationStates = enumerateStates(
    /** @type {Orientation} */ ({ up: "U", front: "F" }),
    (orientation, rotKey) => Move.transposeOrientation({ ...orientation }, rotKey),
    identifyOrientation
);

/** Every orientation of the cube */
export const ORIENTATIONS = Object.freeze(orientationStates.states);

/** Orientation index after a rotation, at orientation * ROTATION_COUNT + rotation */
export const ORIENTATION_AFTER = orientationStates.after;

/** @type {ReadonlyMap<string, number>} */
const orientationIndexes = new Map(ORIENTATIONS.map((orientation, i) => [identifyOrientation(orientation), i]));

/**
 * @param {Orientation} orientation
 * @returns {number} Index of the orientation in ORIENTATIONS
 */
export function getOrientationIndex(orientation) {
    const index = orientationIndexes.get(identifyOrientation(orientation));
    if (index === undefined) throw new Error(`Unknown orientation: ${orientation.up} ${orientation.front}`);
    return index;
}

/** @type {(permutation: FacePermutation | null) => string} */
const identifyPermutation = (permutation) => Move.MOVE_LIST.map(face => permutation ? permutation[face] : face).join("");

const permutationStates = enumerateStates(
    /** @type {FacePermutation | null} */ (null),
    (permutation, rotKey) => {
        const rotation = Move.TRANSPOSITIONS[rotKey];
        return Object.freeze(Object.fromEntries(Move.MOVE_LIST.map(face => [face, rotation[permutation ? permutation[face] : face]])));
    },
    identifyPermutation
);

/** The net effect of a sequence of rotations on move faces */
export const PERMUTATIONS = Object.freeze(permutationStates.states);

/** Permutation index after appending a rotation, at permutation * ROTATION_COUNT + rotation */
export const PERMUTATION_AFTER = permutationStates.after;

/** Alpha index of a face move after a permutation is applied, at permutation * FACE_COUNT + alpha */
export const PERMUTATION_FACE = Int8Array.from(PERMUTATIONS.flatMap(permutation =>
    Move.MOVE_LIST.map(face => ALPHA_INDEXES[permutation ? permutation[face] : face])
));

/** Alpha index of the opposite face, which is the alpha of a move once it becomes a wide move */
export const WIDE_OPPOSITE = Int8Array.from(Move.MOVE_LIST.map(face => ALPHA_INDEXES[Move.WIDE_EQUIVALENTS[face]]));

/**The rotation index that performing a wide move applies to the cube, at (alpha * 2 + prime) * 2 + double */
export const WIDE_ROTATION = Int8Array.from(Move.MOVE_LIST.flatMap(face => [false, true].flatMap(isPrime => [false, true].map(isDouble => {
    const wide = new Move(face, isPrime, isDouble, false, true);
    const rotKey = wide.getAssociatedRotation();
    if (!rotKey) throw new Error(`No rotation for wide move ${wide.toKey()}`);
    return ROTATION_INDEXES[rotKey];
}))));

/**
 * @param {number} alphaIndex Index in ALPHAS of a face
 * @param {boolean} isPrime
 * @param {boolean} isDouble
 * @returns {number} The rotation index performing that wide move applies to the cube
 */
export function getWideRotation(alphaIndex, isPrime, isDouble) {
    return WIDE_ROTATION[(alphaIndex * 2 + Number(isPrime)) * 2 + Number(isDouble)];
}
