import { ScrambleParser } from "./parser.js";
/** @import { Transition } from "./evaluator.js" */
/** @import { Orientation } from "./util.js" */

/** @typedef {"" | "'" | "2" | "2'"} ModifierStr */
/** @typedef {"M" | "E" | "S"} MiddleStr */
/** @typedef {"R" | "L" | "U" | "B" | "D" | "F"} FaceStr */
/** @typedef {"r" | "l" | "u" | "b" | "d" | "f"} WideFaceStr */
/** @typedef {"x" | "y" | "z"} AxisStr */
/** @typedef {`${FaceStr | MiddleStr}${ModifierStr}`} MoveKey */
/** @typedef {`${FaceStr | MiddleStr | WideFaceStr}${"w" | ""}${ModifierStr}`} MoveStr */
/** @typedef {`${AxisStr}${ModifierStr}`} RotationStr */
/** @typedef {Record<RotationStr, Record<FaceStr | AxisStr, FaceStr | AxisStr>>} TranspositionMap */
/** @typedef {Readonly<Record<string, FaceStr | AxisStr>>} FacePermutation The net effect of a sequence of rotations on move faces */

/** @type {Map<string, FacePermutation>} Interned permutations, so there are only 24 */
const PERMUTATIONS = new Map();

/** @type {Map<FacePermutation | null, Map<RotationStr, FacePermutation>>} Memoized Move.composeTransposition results */
const COMPOSITIONS = new Map();

export class Move {
    /** @type {readonly FaceStr[]} */
    static MOVE_LIST = Object.freeze(["R", "L", "U", "D", "F", "B"]);

    /** @type {readonly MiddleStr[]} */
    static MIDDLE_MOVE_LIST = Object.freeze(["M", "E", "S"]);

    /** @type {readonly AxisStr[]} */
    static ROTATION_LIST = Object.freeze(["x", "y", "z"]);

    /** @type {readonly (RotationStr | null)[]} */
    static TOP_ROTATIONS = Object.freeze([null, "x", "x'", "x2", "z", "z'"]);

    /** @type {readonly (RotationStr | null)[]} */
    static FRONT_ROTATIONS = Object.freeze([null, "y", "y'", "y2"]);

    /** @type {Record<MoveKey, MoveKey>} */
    static MIRROR_MOVE_MAP = Object.freeze({
        "R": "L'", "R'": "L", "R2": "L2'", "R2'": "L2",
        "L": "R'", "L'": "R", "L2": "R2'", "L2'": "R2",
        "U": "U'", "U'": "U", "U2": "U2'", "U2'": "U2",
        "D": "D'", "D'": "D", "D2": "D2'", "D2'": "D2",
        "F": "F'", "F'": "F", "F2": "F2'", "F2'": "F2",
        "B": "B'", "B'": "B", "B2": "B2'", "B2'": "B2",
        "M": "M",  "M'": "M'", "M2": "M2",  "M2'": "M2'",
        "E": "E'", "E'": "E", "E2": "E2'", "E2'": "E2",
        "S": "S'", "S'": "S", "S2": "S2'", "S2'": "S2",
    });

    /** @type {TranspositionMap} */
    static TRANSPOSITIONS = Object.freeze(/** @type {TranspositionMap} */ ({
        "x":   { "R": "R", "L": "L", "U": "B", "B": "D", "D": "F", "F": "U" },
        "x'":  { "R": "R", "L": "L", "U": "F", "B": "U", "D": "B", "F": "D" },
        "x2":  { "R": "R", "L": "L", "U": "D", "B": "F", "D": "U", "F": "B" },
        "x2'": { "R": "R", "L": "L", "U": "D", "B": "F", "D": "U", "F": "B" },
        "y":   { "R": "F", "L": "B", "U": "U", "B": "R", "D": "D", "F": "L" },
        "y'":  { "R": "B", "L": "F", "U": "U", "B": "L", "D": "D", "F": "R" },
        "y2":  { "R": "L", "L": "R", "U": "U", "B": "F", "D": "D", "F": "B" },
        "y2'": { "R": "L", "L": "R", "U": "U", "B": "F", "D": "D", "F": "B" },
        "z":   { "R": "D", "L": "U", "U": "R", "B": "B", "D": "L", "F": "F" },
        "z'":  { "R": "U", "L": "D", "U": "L", "B": "B", "D": "R", "F": "F" },
        "z2":  { "R": "L", "L": "R", "U": "D", "B": "B", "D": "U", "F": "F" },
        "z2'": { "R": "L", "L": "R", "U": "D", "B": "B", "D": "U", "F": "F" },
    }));

    /** @type {TranspositionMap} */
    static INV_TRANSPOSITIONS = Object.freeze((() => {
        /** @type {Record<string, Record<string, string>>} */
        const inv = {};
        for (const rotKey in Move.TRANSPOSITIONS) {
            const key = /** @type {RotationStr} */ (rotKey);
            inv[key] = {};
            for (const [from, to] of Object.entries(Move.TRANSPOSITIONS[key])) {
                inv[key][to] = from;
            }
        }
        return /** @type {TranspositionMap} */ (inv);
    })());

    /** @type {Partial<Record<MoveKey, RotationStr>>} */
    static WIDE_ROTATIONS = Object.freeze({
        "R": "x",  "R'": "x'", "R2": "x2",  "R2'": "x2'",
        "L": "x'", "L'": "x",  "L2": "x2'", "L2'": "x2",
        "U": "y",  "U'": "y'", "U2": "y2",  "U2'": "y2'",
        "D": "y'", "D'": "y",  "D2": "y2'", "D2'": "y2",
        "F": "z",  "F'": "z'", "F2": "z2",  "F2'": "z2'",
        "B": "z'", "B'": "z",  "B2": "z2'", "B2'": "z2",
    });

    /** @type {Partial<Record<MoveKey, RotationStr>>} */
    static MIDDLE_ROTATIONS = Object.freeze({
        "M": "x'", "M'": "x", "M2": "x2", "M2'": "x2'",
        "E": "y'", "E'": "y", "E2": "y2", "E2'": "y2'",
        "S": "z",  "S'": "z'", "S2": "z2", "S2'": "z2'",
    });

    /** @type {Partial<Record<MoveKey, MoveKey[]>>} */
    static DECOMPOSED_FACE_MOVES = Object.freeze({
        "M": ["R", "L'"], "M'": ["R'", "L"], "M2": ["R2", "L2'"], "M2'": ["R2'", "L2"],
        "E": ["U", "D'"], "E'": ["U'", "D"], "E2": ["U2", "D2'"], "E2'": ["U2'", "D2"],
        "S": ["F'", "B"], "S'": ["F", "B'"], "S2": ["F2'", "B2"], "S2'": ["F2", "B2'"],
    });

    /** @type {Record<FaceStr, FaceStr>} */
    static WIDE_EQUIVALENTS = Object.freeze({
        R: 'L',
        L: 'R',
        U: 'D',
        D: 'U',
        F: 'B',
        B: 'F'
    });

    /** @type {readonly ModifierStr[]} */
    static MODIFIERS = Object.freeze(["", "'", "2", "2'"]);

    /**
     * Appends a rotation to a face permutation. A null permutation is the identity (leaves every move untouched).
     * Applying the result to a move is equivalent to transposing it by each rotation in order.
     * @param {FacePermutation | null} permutation 
     * @param {RotationStr} rotKey 
     * @returns {FacePermutation}
     */
    static composeTransposition(permutation, rotKey) {
        let compositions = COMPOSITIONS.get(permutation);
        if (!compositions) {
            compositions = new Map();
            COMPOSITIONS.set(permutation, compositions);
        }
        let result = compositions.get(rotKey);
        if (!result) {
            const rotation = Move.TRANSPOSITIONS[rotKey];
            const composed = permutation
                ? Object.fromEntries(Object.entries(permutation).map(([face, to]) => [face, rotation[to]]))
                : rotation;
            const signature = JSON.stringify(composed);
            result = PERMUTATIONS.get(signature) ?? Object.freeze({ ...composed });
            PERMUTATIONS.set(signature, result);
            compositions.set(rotKey, result);
        }
        return result;
    }

    /**
     * Transposes an orientation object in-place according to a given cube rotation string.
     * @param {Orientation} orientation 
     * @param {RotationStr} rotKey 
     * @returns {Orientation}
     */
    static transposeOrientation(orientation, rotKey) {
        if (!rotKey || !Move.TRANSPOSITIONS[rotKey]) return orientation;
        const trans = Move.TRANSPOSITIONS[rotKey];
        orientation.up = /** @type {FaceStr} */ (trans[orientation.up] || orientation.up);
        orientation.front = /** @type {FaceStr} */ (trans[orientation.front] || orientation.front);
        return orientation;
    }

    /**
     * @param {FaceStr | AxisStr | MiddleStr} [alpha="R"]
     * @param {boolean} [isPrime=false]
     * @param {boolean} [isDouble=false]
     * @param {boolean} [isRotation=false]
     * @param {boolean} [isInvertedSlice=false]
     * @param {boolean} [isMiddle=false]
     * @param {number} [sliceNum=0]
     */
    constructor(alpha = "R", isPrime = false, isDouble = false, isRotation = false, isInvertedSlice = false, isMiddle = false, sliceNum = 0) {
        /** @type {FaceStr | AxisStr | MiddleStr} */
        this.alpha = alpha; 
        /** @type {boolean} */ 
        this.isPrime = isPrime; 
        /** @type {boolean} */ 
        this.isDouble = isDouble;
        /** @type {boolean} */ 
        this.isInvertedSlice = isInvertedSlice;
        /** @type {boolean} */ 
        this.isRotation = isRotation;
        /** @type {boolean} */ 
        this.isMiddle = isMiddle;
        /** @type {number} */ 
        this.sliceNum = sliceNum;
        /** @type {Transition | null} */
        this.transition = null;
    }

    /**
     * @param {boolean} [wedgeNotation]
     * @param {number | null} [cubeSize]
     * @returns {string}
     */
    toString(wedgeNotation = false, cubeSize = null) {
        let s = "";
        const resolvedSize = cubeSize ?? 3;

        if (this.isRotation) {
            s += this.alpha.toLowerCase();
        } else {
            const physicalSlices = this.getPhysicalSlices(resolvedSize);

            let prefix = "";
            let face = this.alpha.toUpperCase();
            let suffix = "";

            if (wedgeNotation) {
                if (physicalSlices > 1) {
                    prefix = physicalSlices > 2 ? physicalSlices.toString() : "";
                    suffix = "w";
                }
            } else {
                if (physicalSlices * 2 > resolvedSize && physicalSlices < resolvedSize) {
                    face = face.toLowerCase();
                    const invertedSlices = resolvedSize - physicalSlices;
                    
                    if (invertedSlices === 1) {
                        suffix = "";
                    } else if (invertedSlices === 2) {
                        suffix = "w";
                    } else {
                        prefix = invertedSlices.toString();
                        suffix = "w";
                    }
                } else {
                    if (physicalSlices > 1) {
                        prefix = physicalSlices > 2 ? physicalSlices.toString() : "";
                        suffix = "w";
                    }
                }
            }
            
            s += `${prefix}${face}${suffix}`;
        }

        if (this.isDouble) s += "2";
        if (this.isPrime) s += "'";
        return s;
    }

    /**
     * @returns {MoveKey}
     */
    toKey() {
        let s = this.alpha;
        if (this.isDouble) s += "2";
        if (this.isPrime) s += "'";
        return /** @type {MoveKey} */ (s);
    }

    /**
     * Update this move to its equivalent after a rotation is performed
     * @param {RotationStr} string 
     */
    transpose(string) {
        this.alpha = Move.TRANSPOSITIONS[string][/** @type {FaceStr} */ (this.alpha)]; // TODO isMiddle?
    }

    /**
     * Update this move to its equivalent after all rotations in a face permutation are performed
     * @param {FacePermutation | null} permutation 
     */
    transposeWith(permutation) {
        if (permutation) this.alpha = permutation[this.alpha];
    }

    /**
     * Update this move to its inverse equivalent when removing a rotation
     * @param {RotationStr} string 
     */
    transposeInverse(string) {
        this.alpha = Move.INV_TRANSPOSITIONS[string][/** @type {FaceStr} */ (this.alpha)]; // TODO isMiddle?
    }

    /**
     * Calculates the actual physical number of slices being turned.
     * @param {number | null} [cubeSize] - The dimensions of the cube (e.g., 3 for 3x3x3, or null for 3x3 default)
     * @returns {number} The number of slices affected by the move
     */
    getPhysicalSlices(cubeSize = null) {        
        const resolvedSize = cubeSize ?? 3;
        const parsedSliceNum = this.sliceNum || 1;
        return this.isInvertedSlice ? (resolvedSize - parsedSliceNum) : parsedSliceNum;
    }

    /**
     * Copies properties from a target Move instance into this move.
     * @param {Move} target
     */
    copy(target) {
        this.alpha = target.alpha;
        this.isPrime = target.isPrime;
        this.isDouble = target.isDouble;
        this.isInvertedSlice = target.isInvertedSlice;
        this.isRotation = target.isRotation;
        this.isMiddle = target.isMiddle;
        this.sliceNum = target.sliceNum;
        this.transition = target.transition ? target.transition : null;
        return this;
    }

    /**
     * Creates a new Move instance cloned from this move.
     */
    clone() {
        return new Move().copy(this);
    }

    /**
     * Inverts this move in-place by toggling its prime state.
     */
    invert() {
        this.isPrime = !this.isPrime;
        return this;
    }

    /**
     * Decomposes any move into its constituent face moves and associated cube rotation.
     * @param {{ faceMoves?: Move[], rotation?: RotationStr | null }} [target] Optional target container
     */
    decompose(target = {}) {
        const rotation = this.getAssociatedRotation();
        target.rotation = rotation;

        if (!target.faceMoves) {
            target.faceMoves = [];
        } else {
            target.faceMoves.length = 0;
        }

        if (this.isRotation) {
            return target;
        }

        if (this.isMiddle) {
            const keys = Move.DECOMPOSED_FACE_MOVES[this.toKey()];
            if (keys) {
                for (let i = 0; i < keys.length; i++) {
                    target.faceMoves.push(ScrambleParser.parse(keys[i]).moves[0]);
                }
                return target;
            }            
        }

        if (this.isInvertedSlice) {
            const oppFace = Move.WIDE_EQUIVALENTS[/** @type {FaceStr} */ (this.alpha)];
            if(oppFace) {
                target.faceMoves.push(new Move(oppFace, this.isPrime, this.isDouble, false, false, false, this.sliceNum));
                return target;
            }
        }

        target.faceMoves.push(this.clone());
        return target;
    }

    /**
     * Converts this move in-place to its wide move equivalent.
     */
    toWide() {
        this.alpha = Move.WIDE_EQUIVALENTS[/** @type {FaceStr} */ (this.alpha)] || this.alpha;
        this.isInvertedSlice = true;
        return this;
    }

    /**
     * Gets the cube rotation string associated with this move.
     * @returns {RotationStr | null}
     */
    getAssociatedRotation() {
        if (this.isRotation) return /** @type {RotationStr} */ (this.toKey());
        if (this.isInvertedSlice) return Move.WIDE_ROTATIONS[this.toKey()] || null;
        if (this.isMiddle) return Move.MIDDLE_ROTATIONS[this.toKey()] || null;
        return null;
    }
}