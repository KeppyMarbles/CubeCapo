/** @import { Move } from "./cube/move.js" */

/** @typedef {'F' | 'U' | 'D' | 'Bu' | 'Bd'} ThumbPosition */
/** @typedef {"" | "'" | "2" | "2'"} ModifierStr */
/** @typedef {"R" | "L" | "U" | "B" | "D" | "F"} FaceStr */
/** @typedef {"r" | "l" | "u" | "b" | "d" | "f"} WideFaceStr */
/** @typedef {"x" | "y" | "z"} AxisStr */

/**
 * @typedef {(
 *   | "right_index"
 *   | "right_index_push"
 *   | "right_index_middle"
 *   | "right_ring"
 *   | "right_ring_middle"
 *   | "right_ring_push"
 *   | "right_up"
 *   | "right_up_double"
 *   | "right_down"
 *   | "right_down_double"
 *   | "left_index"
 *   | "left_index_push"
 *   | "left_index_middle"
 *   | "left_ring"
 *   | "left_ring_middle"
 *   | "left_ring_push"
 *   | "left_up"
 *   | "left_up_double"
 *   | "left_down"
 *   | "left_down_double"
 * )} Fingertrick
 */

/** @typedef {`${ThumbPosition} ${ThumbPosition}` | "start"} GripState */
/** @typedef {`${FaceStr}${ModifierStr}`} MoveKey */
/** @typedef {`${FaceStr | WideFaceStr}${"w" | ""}${ModifierStr}`} MoveStr */
/** @typedef {`${AxisStr}${ModifierStr}`} RotationStr */

/** @typedef {Record<Fingertrick, number>} FingertrickCosts */
/** @typedef {Record<GripState, number>} GripCosts */
/** @typedef {Record<WideFaceStr | FaceStr, number>} AlphaCosts */

/**
 * @typedef {Object} GeneralCosts
 * @property {number} regrip Cost of a regrip occuring
 * @property {number} double Cost of a double move
 * @property {number} repeatPenalty Cost of the same fingertrick occuring twice in a row
 * @property {number} wideMultiplier Cost scalar for wide moves
 */

/**
 * @typedef {Object} CostConfig
 * @property {GeneralCosts} general
 * @property {AlphaCosts} alpha Cost of a specific face
 * @property {GripCosts} grip Cost of a specific grip state
 * @property {FingertrickCosts} fingertrick Cost of a specific fingertrick
 */

/**
 * @typedef {Object} Transition
 * @property {GripState} next The resulting grip after the fingertrick
 * @property {Fingertrick} type The fingertrick used
 * @property {boolean} regrip If a regrip happened when getting to the resulting grip
 */

/** @typedef {Record<GripState, Record<MoveKey, Transition>>} TransitionConfig */

/** 
 * @typedef {Object} Orientation
 * @property {FaceStr} up The face on top
 * @property {FaceStr} front The face in front
 */

/** 
 * @typedef {Object} Rotation
 * @property {RotationStr} up The top rotation
 * @property {RotationStr} front The front rotation
 */

/**
 * @typedef {Object} RunOptions
 * @property {Move[]} scramble The scramble to optimize
 * @property {number} depth The branch pruning threshold
 * @property {number} maxIterations Number of iterations to try before bailing out
 * @property {boolean} searchRotations If all orientations should be searched
 * @property {boolean} pruneRotations If an orientation search should be stopped if worse than best orientation
 * @property {boolean} memoize If search shouldn't continue if same index, orientation and grip is reached
 * @property {boolean} wideReplaceDouble If search should try replacing double moves with 1 wide and 1 normal move
 */

/**
 * @typedef OrientationResultInfo
 * @property {Rotation} rotation The rotation applied at the beginning of the scramble
 * @property {number} cost The scramble cost
 * @property {number} iterations The number of iterations of bruteforceOptimize
 * @property {boolean} maxed If the max iteration count was hit
 */

/**
 * @typedef ScrambleBreakdownEntry
 * @property {MoveStr} move The move for this step
 * @property {Transition} transition The transition occuring from this move
 * @property {number} addedCost The cost of the transition
 */

export {}