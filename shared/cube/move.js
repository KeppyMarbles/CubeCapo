import { ScrambleParser } from "./parser.js";
/** @import { FaceStr, RotationStr, AxisStr, MoveStr, MiddleStr, MoveKey, ThumbPosition, GripState, Transition, Orientation, ModifierStr, TranspositionMap, ThumbTransitions, RegripDistanceCache, RegripDistanceCacheRow, NextGripCache, NextGripCacheRow, Fingertrick } from "../types.js" */

export class Move {
    /**
     * Splits a GripState string into its two ThumbPosition components
     * @param {GripState} grip
     * @returns {[ThumbPosition, ThumbPosition]}
     */
    static splitGrip(grip) {
        return /** @type {[ThumbPosition, ThumbPosition]} */ (grip.split(" "));
    }

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

    /** @type {Record<Fingertrick, Fingertrick>} */
    static MIRROR_FINGERTRICK_MAP = Object.freeze({
        "right_index":        "left_index",
        "right_index_push":   "left_index_push",
        "right_index_front":  "left_index_front",
        "right_index_middle": "left_index_middle",
        "right_ring":         "left_ring",
        "right_ring_middle":  "left_ring_middle",
        "right_ring_push":    "left_ring_push",
        "right_middle":       "left_middle",
        "right_middle_push":  "left_middle_push",
        "right_thumb":        "left_thumb",
        "right_up":           "left_up",
        "right_up_double":    "left_up_double",
        "right_down":         "left_down",
        "right_down_double":  "left_down_double",

        "left_index":         "right_index",
        "left_index_push":    "right_index_push",
        "left_index_front":   "right_index_front",
        "left_index_middle":  "right_index_middle",
        "left_ring":          "right_ring",
        "left_ring_middle":   "right_ring_middle",
        "left_ring_push":     "right_ring_push",
        "left_middle":        "right_middle",
        "left_middle_push":   "right_middle_push",
        "left_thumb":         "right_thumb",
        "left_up":            "right_up",
        "left_up_double":     "right_up_double",
        "left_down":          "right_down",
        "left_down_double":   "right_down_double",
    });

    /**
     * Mirrors a move across the M-slice
     * @param {MoveKey} moveKey
     * @returns {MoveKey}
     */
    static mirrorMove(moveKey) {
        return Move.MIRROR_MOVE_MAP[moveKey] ?? moveKey;
    }

    /**
     * Mirrors a fingertrick across the M-slice
     * @param {Fingertrick} ft
     * @returns {Fingertrick}
     */
    static mirrorFingertrick(ft) {
        return Move.MIRROR_FINGERTRICK_MAP[ft] ?? ft;
    }

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

    /** @type {Record<ThumbPosition, number>} */
    static THUMB_POSITIONS = Object.freeze({
        "Bd": 0,
        "D": 1,
        "F": 2,
        "U": 3,
        "Bu": 4
    });

    /** @type {ThumbTransitions} */
    static R_TRANSITIONS = Object.freeze({
        "R":   { "Bd": "D",  "D": "F",  "F": "U",  "U": "Bu", "Bu": null },
        "R'":  { "Bu": "U",  "U": "F",  "F": "D",  "D": "Bd", "Bd": null },
        "R2":  { "Bd": "F",  "D": "U",  "F": "Bu", "U": null, "Bu": null },
        "R2'": { "Bu": "F",  "U": "D",  "F": "Bd", "D": null, "Bd": null },
    });

    /** @type {ThumbTransitions} */
    static L_TRANSITIONS = Object.freeze({
        "L":   { "Bu": "U",  "U": "F",  "F": "D",  "D": "Bd", "Bd": null },
        "L'":  { "Bd": "D",  "D": "F",  "F": "U",  "U": "Bu", "Bu": null },
        "L2":  { "Bu": "F",  "U": "D",  "F": "Bd", "D": null, "Bd": null },
        "L2'": { "Bd": "F",  "D": "U",  "F": "Bu", "U": null, "Bu": null },
    });

    /** @type {Partial<Record<RotationStr, MoveKey>>} */
    static X_ROTATION_MAP = Object.freeze({
        "x": "R",
        "x'": "R'",
        "x2": "R2",
        "x2'": "R2'"
    });

    /** @type {readonly ModifierStr[]} */
    static MODIFIERS = Object.freeze(["", "'", "2", "2'"]);

    /** @type {readonly ThumbPosition[]} */
    static THUMB_KEYS = Object.freeze(["Bd", "D", "F", "U", "Bu"]);

    /** @type {readonly GripState[]} Flat list of all 25 explicit grip combinations */
    static ALL_GRIPS = Object.freeze(/** @type {readonly GripState[]} */ (Move.THUMB_KEYS.flatMap(l => Move.THUMB_KEYS.map(r => /** @type {GripState} */ (`${l} ${r}`)))));

    /** @type {readonly MoveKey[]} Face and slice moves that do not change thumb positions */
    static FINGERTRICK_MOVES = Object.freeze(/** @type {readonly MoveKey[]} */ (["U", "D", "F", "B", "M", "E", "S"].flatMap(m =>
        Move.MODIFIERS.map(mod => /** @type {MoveKey} */ (`${m}${mod}`))
    )));

    /** @type {RegripDistanceCache} */
    static REGRIP_DIST_CACHE = Object.freeze((() => {
        const cache = /** @type {RegripDistanceCache} */ ({});
        for (const g1 of Move.ALL_GRIPS) {
            cache[g1] = /** @type {RegripDistanceCacheRow} */ ({});
            const [l1, r1] = Move.splitGrip(g1);
            const pL1 = Move.THUMB_POSITIONS[l1] ?? 0;
            const pR1 = Move.THUMB_POSITIONS[r1] ?? 0;
            for (const g2 of Move.ALL_GRIPS) {
                const [l2, r2] = Move.splitGrip(g2);
                const lDist = Math.abs(pL1 - (Move.THUMB_POSITIONS[l2] ?? 0));
                const rDist = Math.abs(pR1 - (Move.THUMB_POSITIONS[r2] ?? 0));
                cache[g1][g2] = lDist + rDist;
            }
        }
        return cache;
    })());

    /** @type {NextGripCache} */
    static NEXT_GRIP_CACHE = Object.freeze((() => {
        const cache = /** @type {NextGripCache} */ ({});
        for (const grip of Move.ALL_GRIPS) {
            const [l, r] = Move.splitGrip(grip);
            /** @type {NextGripCacheRow} */
            const row = /** @type {NextGripCacheRow} */ ({});

            // R moves the right thumb
            for (const moveKey in Move.R_TRANSITIONS) {
                const key = /** @type {MoveKey} */ (moveKey);
                const transitions = Move.R_TRANSITIONS[key];
                const nextRight = transitions ? transitions[r] : null;
                row[key] = nextRight ? `${l} ${nextRight}` : null;
            }
            // L moves the left thumb
            for (const moveKey in Move.L_TRANSITIONS) {
                const key = /** @type {MoveKey} */ (moveKey);
                const transitions = Move.L_TRANSITIONS[key];
                const nextLeft = transitions ? transitions[l] : null;
                row[key] = nextLeft ? `${nextLeft} ${r}` : null;
            }
            // x moves both thumbs
            for (const moveKey in Move.X_ROTATION_MAP) {
                const rotKey = /** @type {RotationStr} */ (moveKey);
                const rMap = Move.X_ROTATION_MAP[rotKey];
                const transitions = rMap ? Move.R_TRANSITIONS[rMap] : null;
                const nextLeft = transitions ? transitions[l] : null;
                const nextRight = transitions ? transitions[r] : null;
                row[rotKey] = (nextLeft && nextRight) ? `${nextLeft} ${nextRight}` : null;
            }
            // Fingertrick moves keep the grip
            for (const moveKey of Move.FINGERTRICK_MOVES) {
                row[moveKey] = grip;
            }

            cache[grip] = row;
        }
        return cache;
    })());

    /**
     * Calculates the chain step distance between two grip states along Bd <-> D <-> F <-> U <-> Bu
     * @param {GripState} fromGrip 
     * @param {GripState} toGrip 
     * @returns {number}
     */
    static computeRegripDistance(fromGrip, toGrip) {
        if (!fromGrip || !toGrip || fromGrip === toGrip) return 0;
        return Move.REGRIP_DIST_CACHE[fromGrip]?.[toGrip] ?? Infinity;
    }

    /**
     * Calculates the resulting grip state after performing a move from currentGrip.
     * @param {GripState} currentGrip 
     * @param {MoveKey | RotationStr} moveKey 
     * @returns {GripState | null}
     */
    static computeNextGrip(currentGrip, moveKey) {
        if (!currentGrip) return null;
        const row = Move.NEXT_GRIP_CACHE[currentGrip];
        return row?.[moveKey] ?? null;
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