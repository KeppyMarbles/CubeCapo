import { Move } from "./move.js";
/** @import { ThumbPosition, GripState, FingerAction, RightFingertrick, LeftFingertrick, Fingertrick, RotationStr, MoveKey, CostConfig, TransitionConfig, TransitionCache, TransitionCacheRow, Transition, ExecutionStep, CostDetails, RegripDistanceCache, RegripDistanceCacheRow, FaceStr } from "../types.js" */

/** @type {readonly ThumbPosition[]} Standard 5 thumb positions in physical axis order (Bd <-> D <-> F <-> U <-> Bu) */
export const THUMB_POSITIONS = Object.freeze(/** @type {readonly ThumbPosition[]} */ (["Bd", "D", "F", "U", "Bu"]));

/** @type {readonly GripState[]} Flat list of all 25 explicit grip combinations */
export const ALL_GRIPS = Object.freeze(/** @type {readonly GripState[]} */ (THUMB_POSITIONS.flatMap(l => THUMB_POSITIONS.map(r => /** @type {GripState} */ (`${l} ${r}`)))));

/** @type {Record<RightFingertrick, LeftFingertrick>} */
const RIGHT_TO_LEFT_FINGERTRICK = Object.freeze({
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
});

/** @type {Record<LeftFingertrick, RightFingertrick>} */
const LEFT_TO_RIGHT_FINGERTRICK = Object.freeze(/** @type {Record<LeftFingertrick, RightFingertrick>} */ (
    Object.fromEntries(Object.entries(RIGHT_TO_LEFT_FINGERTRICK).map(([r, l]) => [l, r]))
));

/** @type {readonly RightFingertrick[]} List of all 14 right-hand fingertricks */
export const RIGHT_FINGERTRICKS = Object.freeze(/** @type {readonly RightFingertrick[]} */ (Object.keys(RIGHT_TO_LEFT_FINGERTRICK)));

/** @type {readonly LeftFingertrick[]} List of all 14 left-hand fingertricks */
export const LEFT_FINGERTRICKS = Object.freeze(/** @type {readonly LeftFingertrick[]} */ (Object.values(RIGHT_TO_LEFT_FINGERTRICK)));

/**
 * Mirrors a right-hand fingertrick to the left hand across the M-slice
 * @param {RightFingertrick} ft
 * @returns {LeftFingertrick}
 */
export function mirrorRightFingertrick(ft) {
    return RIGHT_TO_LEFT_FINGERTRICK[ft];
}

/**
 * Mirrors a left-hand fingertrick to the right hand across the M-slice
 * @param {LeftFingertrick} ft
 * @returns {RightFingertrick}
 */
export function mirrorLeftFingertrick(ft) {
    return LEFT_TO_RIGHT_FINGERTRICK[ft];
}

/** @type {Partial<Record<FingerAction, Record<ThumbPosition, ThumbPosition | null>>>} */
const WRIST_TRANSITIONS = Object.freeze({
    "up":          { "Bd": "D",  "D": "F",  "F": "U",  "U": "Bu", "Bu": null },
    "down":        { "Bu": "U",  "U": "F",  "F": "D",  "D": "Bd", "Bd": null },
    "up_double":   { "Bd": "F",  "D": "U",  "F": "Bu", "U": null, "Bu": null },
    "down_double": { "Bu": "F",  "U": "D",  "F": "Bd", "D": null, "Bd": null },
});

/** @type {Partial<Record<RotationStr, FingerAction>>} */
const X_ROTATION_ACTIONS = Object.freeze({
    "x": "up",
    "x'": "down",
    "x2": "up_double",
    "x2'": "down_double"
});

/**
 * Splits a GripState string into its two ThumbPosition components
 * @param {GripState} grip
 * @returns {[ThumbPosition, ThumbPosition]}
 */
export function splitGrip(grip) {
    return /** @type {[ThumbPosition, ThumbPosition]} */ (grip.split(" "));
}

/** @type {RegripDistanceCache} */
const REGRIP_DIST_CACHE = Object.freeze((() => {
    const cache = /** @type {RegripDistanceCache} */ ({});
    for (const g1 of ALL_GRIPS) {
        cache[g1] = /** @type {RegripDistanceCacheRow} */ ({});
        const [l1, r1] = splitGrip(g1);
        const pL1 = THUMB_POSITIONS.indexOf(l1);
        const pR1 = THUMB_POSITIONS.indexOf(r1);
        for (const g2 of ALL_GRIPS) {
            const [l2, r2] = splitGrip(g2);
            const lDist = Math.abs(pL1 - THUMB_POSITIONS.indexOf(l2));
            const rDist = Math.abs(pR1 - THUMB_POSITIONS.indexOf(r2));
            cache[g1][g2] = lDist + rDist;
        }
    }
    return cache;
})());

/**
 * Calculates the chain step distance between two grip states along Bd <-> D <-> F <-> U <-> Bu
 * @param {GripState} fromGrip 
 * @param {GripState} toGrip 
 * @returns {number}
 */
export function computeRegripDistance(fromGrip, toGrip) {
    if (!fromGrip || !toGrip || fromGrip === toGrip) return 0;
    return REGRIP_DIST_CACHE[fromGrip]?.[toGrip] ?? Infinity;
}

/**
 * Programmatically computes the transition (next grip, fingertrick, and regrip factor) for a y rotation.
 * @param {GripState} grip - Starting grip state (e.g. "F F", "U D", "F Bu")
 * @param {RotationStr} rotKey - "y" | "y'" | "y2" | "y2'"
 * @returns {Transition | null}
 */
export function computeYTransition(grip, rotKey) {
    if (!grip) return null;
    const [l, r] = splitGrip(grip);

    const isPivotL = l === "U" || l === "D";
    const isPivotR = r === "U" || r === "D";
    const isBackL = l === "Bu" || l === "Bd";
    const isBackR = r === "Bu" || r === "Bd";
    const isFrontL = l === "F";
    const isFrontR = r === "F";

    let nextL = l;
    let nextR = r;
    let regripL = false;
    let regripR = false;

    if (rotKey === "y" || rotKey === "y'") {
        // 90° Rotations
        if (isPivotL && isPivotR) {
            nextL = l;
            nextR = r;
        } else if (isPivotL) {
            nextL = l;
            nextR = isPivotR ? r : "F";
            regripR = !isPivotR;
        } else if (isPivotR) {
            nextR = r;
            nextL = isPivotL ? l : "F";
            regripL = !isPivotL;
        } else {
            nextL = "F";
            nextR = "F";
            regripL = true;
            regripR = true;
        }
    } else {
        // 180° Rotations (y2, y2')
        if (isPivotL && isPivotR) {
            nextL = l;
            nextR = r;
        } else if (rotKey === "y2" && isFrontL && isBackR) {
            // CW: Left F -> Bu, Right B -> F
            nextL = "Bu";
            nextR = "F";
        } else if (rotKey === "y2'" && isBackL && isFrontR) {
            // CCW: Left B -> F, Right F -> Bu
            nextL = "F";
            nextR = "Bu";
        } else if (isPivotL && isBackR && rotKey === "y2") {
            // Left pivot, Right B -> F
            nextL = l;
            nextR = "F";
        } else if (isPivotR && isBackL && rotKey === "y2'") {
            // Right pivot, Left B -> F
            nextL = "F";
            nextR = r;
        } else if (isBackL && isBackR) {
            // Both on back: matching thumb pivots to F, non-matching thumb regrips (partial regrip)
            nextL = "F";
            nextR = "F";
            if (rotKey === "y2") regripL = true;
            else regripR = true;
        } else if (isPivotL) {
            nextL = l;
            nextR = isPivotR ? r : "F";
            regripR = !isPivotR;
        } else if (isPivotR) {
            nextR = r;
            nextL = isPivotL ? l : "F";
            regripL = !isPivotL;
        } else {
            nextL = "F";
            nextR = "F";
            regripL = true;
            regripR = true;
        }
    }

    /** @type {Fingertrick} */
    const type = (rotKey === "y" || rotKey === "y'") ? "rotation" : "rotation_double";

    // Regrip factor: 1.0 (full regrip) if both hands lift, 0.5 (half regrip) if one hand lifts, 0 if pure pivot
    let regripFactor = 0;
    if (regripL && regripR) {
        regripFactor = 1.0;
    } else if (regripL || regripR) {
        regripFactor = 0.5;
    }

    const nextGrip = /** @type {GripState} */ (`${nextL} ${nextR}`);
    return { next: nextGrip, type, regripFactor };
}

/**
 * Calculates the resulting grip state after performing a transition with a given fingertrick or rotation.
 * @param {GripState} currentGrip 
 * @param {Fingertrick | RotationStr | ""} [transitionType=""]
 * @returns {GripState | null}
 */
export function computeNextGrip(currentGrip, transitionType = "") {
    if (!currentGrip) return null;
    if (!transitionType) return currentGrip;

    // Full-cube X rotations
    if (transitionType.startsWith("x")) {
        const rotKey = /** @type {RotationStr} */ (transitionType);
        const action = X_ROTATION_ACTIONS[rotKey];
        const trans = action ? WRIST_TRANSITIONS[action] : null;
        if (!trans) return currentGrip;
        const [l, r] = splitGrip(currentGrip);
        const nextL = trans[l];
        const nextR = trans[r];
        return (nextL && nextR) ? /** @type {GripState} */ (`${nextL} ${nextR}`) : null;
    }

    // Full-cube Y rotations
    if (transitionType.startsWith("y")) {
        const trans = computeYTransition(currentGrip, /** @type {RotationStr} */ (transitionType));
        return trans ? trans.next : null;
    }

    // Full-cube Z rotations (preserve grips on the F-B axis)
    if (transitionType.startsWith("z")) {
        const [l, r] = splitGrip(currentGrip);
        const isFBL = l === "F" || l === "Bu" || l === "Bd";
        const isFBR = r === "F" || r === "Bu" || r === "Bd";
        return (isFBL && isFBR) ? currentGrip : null;
    }

    if (transitionType.startsWith("right_")) {
        const action = /** @type {FingerAction} */ (transitionType.slice(6));
        const trans = WRIST_TRANSITIONS[action];
        if (!trans) return currentGrip;
        const [l, r] = splitGrip(currentGrip);
        const nextR = trans[r];
        return nextR ? /** @type {GripState} */ (`${l} ${nextR}`) : null;
    } else if (transitionType.startsWith("left_")) {
        const action = /** @type {FingerAction} */ (transitionType.slice(5));
        const trans = WRIST_TRANSITIONS[action];
        if (!trans) return currentGrip;
        const [l, r] = splitGrip(currentGrip);
        const nextL = trans[l];
        return nextL ? /** @type {GripState} */ (`${nextL} ${r}`) : null;
    }

    return currentGrip;
}

export class ExecutionEvaluator {
    /**
     * @param {CostConfig} config 
     * @param {TransitionConfig} transitions 
     */
    constructor(config, transitions) {
        /** @type {CostConfig} */
        this.config = config;
        /** @type {TransitionConfig} */
        this.transitions = transitions;
        /** @type {GripState[]} Invariant list of grip keys */
        this.allGripKeys = /** @type {GripState[]} */ (Object.keys(this.config.grip));
        /** @type {TransitionCache} Cache for transitions */
        this.transitionCache = this.initTransitionCache();
    }

    /**
     * Pre-computes transition objects for fast O(1) lookups during optimization.
     * @returns {TransitionCache}
     */
    initTransitionCache() {
        /** @type {TransitionCache} */
        const cache = /** @type {TransitionCache} */ ({});
        if (!this.transitions) return cache;

        const rightConfig = this.transitions.right;
        const leftConfig = this.transitions.left;
        const handedness = this.config.general.handedness;
        const ftCosts = this.config.fingertrick;

        for (const grip of this.allGripKeys) {
            /** @type {TransitionCacheRow} */
            const cacheRow = {};
            const [l, r] = splitGrip(grip);

            const rMoves = rightConfig ? rightConfig[r] : null;
            const lMovesRaw = rightConfig ? rightConfig[l] : null;
            const lCustomMoves = leftConfig ? leftConfig[l] : null;

            // Resolve left-hand moves: if leftConfig has an override, use it; otherwise mirror from lMovesRaw
            /** @type {Partial<Record<MoveKey, Fingertrick | null>>} */
            const lMoves = {};
            if (lMovesRaw) {
                for (const moveKey in lMovesRaw) {
                    const key = /** @type {MoveKey} */ (moveKey);
                    const mirroredMove = Move.MIRROR_MOVE_MAP[key] ?? key;
                    if (lCustomMoves && lCustomMoves[mirroredMove] !== undefined) {
                        lMoves[mirroredMove] = lCustomMoves[mirroredMove];
                    } else {
                        const ft = lMovesRaw[key];
                        lMoves[mirroredMove] = ft ? mirrorRightFingertrick(ft) : null;
                    }
                }
            }

            // Union of move keys from both hands
            /** @type {Set<MoveKey>} */
            const allMoveKeys = new Set(/** @type {MoveKey[]} */ ([
                ...Object.keys(lMoves),
                ...(rMoves ? Object.keys(rMoves) : [])
            ]));

            for (const key of allMoveKeys) {
                const lFt = lMoves[key];
                const rFt = rMoves ? rMoves[key] : null;

                /** @type {Fingertrick | null | undefined} */
                let selectedFt = null;
                if (lFt && rFt) {
                    const lCost = ftCosts[lFt] ?? 0;
                    const rCost = ftCosts[rFt] ?? 0;
                    if (lCost < rCost) {
                        selectedFt = lFt;
                    } else if (rCost < lCost) {
                        selectedFt = rFt;
                    } else {
                        selectedFt = handedness === "left" ? lFt : rFt;
                    }
                } else {
                    selectedFt = rFt || lFt;
                }

                if (!selectedFt) continue;
                const nextGrip = computeNextGrip(grip, selectedFt);
                if (nextGrip) cacheRow[key] = { next: nextGrip, type: selectedFt };
            }

            // Full-cube X rotations
            for (const rotKey of ["x", "x'", "x2", "x2'"]) {
                const key = /** @type {RotationStr} */ (rotKey);
                const nextGrip = computeNextGrip(grip, key);
                const type = (key === "x" || key === "x'") ? "rotation" : "rotation_double";
                if (nextGrip) cacheRow[key] = { next: nextGrip, type };
            }

            // Full-cube Y rotations
            for (const rotKey of ["y", "y'", "y2", "y2'"]) {
                const key = /** @type {RotationStr} */ (rotKey);
                const trans = computeYTransition(grip, key);
                if (trans) cacheRow[key] = trans;
            }

            // Full-cube Z rotations (grips on F-B axis form a pivot across the B-F axis)
            const isFBL = l === "F" || l === "Bu" || l === "Bd";
            const isFBR = r === "F" || r === "Bu" || r === "Bd";
            if (isFBL && isFBR) {
                cacheRow["z"] = { next: grip, type: "rotation" };
                cacheRow["z'"] = { next: grip, type: "rotation" };
                cacheRow["z2"] = { next: grip, type: "rotation_double" };
            }

            cache[grip] = cacheRow;
        }

        return cache;
    }

    /**
     * @param {GripState} grip 
     * @param {MoveKey | RotationStr} moveKey 
     * @returns {Transition | null}
     */
    getTransition(grip, moveKey) {
        return this.transitionCache?.[grip]?.[moveKey] || null;
    }

    /**
     * @param {Transition} transition 
     * @param {Move} move
     * @param {number | null} [cubeSize=null]
     * @param {GripState} [regripFromGrip] Optional starting grip if a regrip occurred before this move
     * @param {CostDetails} [outDetails] Optional object to populate with itemized cost components
     * @returns {number}
     */
    computeCost(transition, move, cubeSize = null, regripFromGrip, outDetails) {
        if (!transition) return Infinity;

        let added = 0;
        let regripCost = 0;
        if (transition.regripFactor !== undefined) {
            regripCost = transition.regripFactor * (this.config.general.regrip ?? 0);
        } else if (transition.regripCost !== undefined) {
            regripCost = transition.regripCost;
        } else if (regripFromGrip) {
            const distance = computeRegripDistance(regripFromGrip, transition.regripPrompt || transition.next);
            regripCost = (this.config.general.regrip ?? 0) + distance * (this.config.general.regripPerStep ?? 0);
        }
        added += regripCost;

        const gripCost = this.config.grip[transition.next] ?? 0;
        added += gripCost;

        const ftType = /** @type {Fingertrick} */ (transition.type);
        const ftCost = (ftType && this.config.fingertrick[ftType]) ?? 0;
        const totalFtCost = this.config.general.perSliceFingertrick ? move.getPhysicalSlices(cubeSize) * ftCost : ftCost;
        added += totalFtCost;

        const alphaKey = /** @type {FaceStr} */ (move.isInvertedSlice ? move.alpha.toLowerCase() : move.alpha);
        const alphaCost = this.config.alpha[alphaKey] ?? 0;
        added += alphaCost;

        if (outDetails) {
            outDetails.regrip = regripCost;
            outDetails.grip = gripCost;
            outDetails.fingertrick = totalFtCost;
            outDetails.alpha = alphaCost;
        }

        return added;
    }

    /**
     * Evaluates direct execution of a move from a given grip.
     * @param {GripState} grip 
     * @param {Move} move 
     * @param {number | null} [cubeSize=null] 
     * @returns {ExecutionStep | null}
     */
    getDirectStep(grip, move, cubeSize = null) {
        const transition = this.getTransition(grip, move.toKey());
        if (!transition) return null;
        const cost = this.computeCost(transition, move, cubeSize);
        return { transition, nextGrip: transition.next, cost };
    }

    /**
     * Evaluates available candidate regrips to execute a move from a given grip.
     * Returns candidate steps sorted by lowest step cost, bounded by limit.
     * @param {GripState} currentGrip 
     * @param {Move} move 
     * @param {number | null} [cubeSize=null] 
     * @param {number} [limit=Infinity] Maximum number of options to return
     * @returns {ExecutionStep[]}
     */
    getRegripOptions(currentGrip, move, cubeSize = null, limit = Infinity) {
        if (limit <= 0) return [];

        const movedKey = move.toKey();
        const baseRegrip = this.config.general.regrip ?? 0;
        const regripPerStep = this.config.general.regripPerStep ?? 0;
        const distRow = REGRIP_DIST_CACHE[currentGrip];

        /** @type {ExecutionStep[]} */
        const topK = [];

        for (let j = 0; j < this.allGripKeys.length; j++) {
            const targetGrip = this.allGripKeys[j];
            if (targetGrip === currentGrip) continue;

            const targetTrans = this.getTransition(targetGrip, movedKey);
            if (!targetTrans) continue;

            const dist = distRow ? (distRow[targetGrip] ?? 0) : computeRegripDistance(currentGrip, targetGrip);
            const rCost = baseRegrip + dist * regripPerStep;
            /** @type {Transition} */
            const regripTrans = {
                next: targetTrans.next,
                type: targetTrans.type,
                regripFrom: currentGrip,
                regripPrompt: targetGrip,
                regripCost: rCost
            };
            const stepCost = this.computeCost(regripTrans, move, cubeSize, currentGrip);

            if (topK.length < limit || stepCost < topK[topK.length - 1].cost) {
                /** @type {ExecutionStep} */
                const step = {
                    transition: regripTrans,
                    nextGrip: targetTrans.next,
                    cost: stepCost
                };
                let insertIdx = topK.length;
                while (insertIdx > 0 && topK[insertIdx - 1].cost > stepCost) {
                    insertIdx--;
                }
                topK.splice(insertIdx, 0, step);
                if (topK.length > limit) topK.pop();
            }
        }

        return topK;
    }
}