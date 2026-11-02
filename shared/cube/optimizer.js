import { defaultFormatOptions, defaultRunOptions } from "../defaults.js";
import { Move, ALPHAS, ALPHA_INDEXES, ALPHA_COUNT, FACE_COUNT } from "./move.js";
import {
    ROTATION_KEYS, ROTATION_COUNT, ROTATION_INDEXES, ORIENTATIONS, ORIENTATION_AFTER, PERMUTATIONS, PERMUTATION_AFTER, PERMUTATION_FACE, WIDE_OPPOSITE,
    getOrientationIndex, getWideRotation
} from "./rotations.js";
import { getOrientationColors, getRestoringRotation, detectCubeSize, normalizeScramble, getFinalOrientation } from "./util.js";
/** @import { ExecutionEvaluator, GripState, Transition, ExecutionStep, CostDetails } from "./evaluator.js" */
/** @import { Orientation, StartingRotation, ColorSchemeConfig } from "./util.js" */
/** @import { ParseResult, NotationMode } from "./parser.js" */
/** @import { FaceStr, MoveStr, RotationStr } from "./move.js" */

/**
 * @typedef {Object} FormatOptions
 * @property {boolean} [showGrips] If grip prompts (starting grip and regrip transitions) should be included in output
 * @property {boolean} [showBoundaries] If the scramble should show `|` where partitions were made
 * @property {boolean} [wedgeNotation] If wide moves should be output using wedge count notation (e.g. Rw, 3Rw)
 * @property {boolean} [showOrientationColors] If starting orientation should be displayed as color names (e.g. White top, Green front)
 * @property {boolean} [reorient] If ending rotation moves should be appended to undo starting rotation
 * @property {ColorSchemeConfig} [colorScheme] Color mapping for faces
 */

/**
 * @typedef {Object} ScrambleOptions Settings that describe the scramble being optimized
 * @property {number | null} cubeSize Target cube size (e.g. 3 for 3x3, 7 for 7x7), detected automatically if null
 */

/**
 * @typedef {Object} SearchOptions Settings that control how the search is performed
 * @property {number} depth The branch pruning threshold
 * @property {number} maxIterations Number of iterations to try before bailing out
 * @property {number} [maxRegripBranches] Maximum number of candidate regrips to explore when a regrip is required
 * @property {boolean} searchStartingOrientations If all orientations should be searched
 * @property {boolean} pruneStartingOrientations If an orientation search should be stopped if worse than best orientation
 * @property {boolean} memoize If search shouldn't continue if same index, orientation and grip is reached
 * @property {boolean} [wideReplace] If search should try replacing single moves with wide moves
 * @property {boolean} [searchRegrips] If regrip candidates should always be explored, even when a direct transition exists
 * @property {boolean} [injectXRotations] If search should try injecting X rotations mid-scramble
 * @property {boolean} [injectYRotations] If search should try injecting Y rotations mid-scramble
 * @property {boolean} [injectZRotations] If search should try injecting Z rotations mid-scramble
 * @property {number} [partitionLength] Maximum length of scramble partitions (0 or undefined to disable)
 * @property {number} [maxCapacity] Maximum number of candidate scrambles to retain (default 50)
 */

/** @typedef {SearchOptions & ScrambleOptions} RunOptions */

/**
 * @typedef OrientationResultInfo
 * @property {StartingRotation} startingRotation The rotations that put the cube in this starting orientation
 * @property {GripState} [startingGrip] The starting grip used
 * @property {number} cost The scramble cost
 * @property {number} iterations The number of iterations of search
 * @property {boolean} maxed If the max iteration count was hit
 */

/**
 * @typedef {Object} ScrambleCandidate
 * @property {Move[]} scramble Transposed candidate scramble moves
 * @property {number} cost Total cost of candidate
 * @property {StartingRotation} startingRotation The rotations applied at the start to reach the starting orientation
 * @property {Orientation} finalOrientation Final orientation of the cube after scramble
 * @property {GripState} startingGrip Starting thumb placement grip
 * @property {number[]} partitionBoundaries Indices where partition boundaries occur
 * @property {GripState} finalGrip Final thumb placement grip after candidate execution
 * @property {number} [physicalOffset] Cumulative physical index offset due to length-changing transforms
 * @property {number} [logicalIndex] Current logical progress index in the original scramble
 */

/**
 * @typedef ScrambleBreakdownEntry
 * @property {MoveStr} move The move for this step
 * @property {Transition} transition The transition occuring from this move
 * @property {number} addedCost The total cost of the transition
 * @property {CostDetails} [costBreakdown] Itemized breakdown of the cost components (fingertrick, grip, alpha, etc.)
 * @property {boolean} [isPartitionBoundary] If this move starts a new partition
 */

/**
 * @typedef OptimizationResult
 * @property {boolean} success Whether optimization completed successfully
 * @property {string} [bestScrambleStr] Transposed best scramble string
 * @property {ScrambleBreakdownEntry[]} [breakdown] Move-by-move breakdown entries
 * @property {number} [bestCost] Total cost of the optimized scramble
 * @property {number} [searchTime] Search runtime in milliseconds
 * @property {number | null} [cubeSize] Detected cube dimension (e.g. 3 for 3x3)
 * @property {NotationMode} [resolvedNotation] Resolved notation mode ('wca' | 'sign')
 * @property {string} [error] Error message if optimization failed
 */

/**
 * @typedef {(response: OptimizationResult) => void} SendOptimizationResponse
 */

/**
 * @typedef {Object} SearchContext One partition search, from a fixed starting point to a fixed end
 * @property {Move[]} moves The scramble being searched; never modified
 * @property {number} startIndex Index in moves where the search begins
 * @property {number} endIndex Index in moves where the search ends
 * @property {GripState} startGrip The grip the whole scramble started with
 * @property {number} minCost Lowest cost found so far
 * @property {ScrambleCandidate[]} minResults Candidates tied for lowest cost
 */

/**
 * @typedef {Object} StepOption One way to execute a move: directly, or after a regrip
 * @property {Transition} transition
 * @property {number} nextGrip Index of the grip after the move
 * @property {number} cost
 */

/**
 * @typedef {Object} MoveVariant Everything about a move except which face it turns, which the search changes by rotating the cube
 * @property {number} sliceNum
 * @property {boolean} isPrime
 * @property {boolean} isDouble
 * @property {boolean} isInvertedSlice
 * @property {boolean} isRotation
 * @property {boolean} isMiddle
 * @property {(StepOption[] | undefined)[]} options Ways to execute the move, indexed by alpha * grip count + grip
 */

/** Rotations that the search can inject mid-scramble, by axis */
const INJECTABLE_ROTATIONS = Object.freeze({
    z: Object.freeze(["z", "z'", "z2"]),
    x: Object.freeze(["x", "x'", "x2"]),
    y: Object.freeze(["y", "y'", "y2"]),
});

export class ScrambleOptimizer {
    /**
     * Computes a unique signature string for deduplicating scramble candidates.
     * @param {ScrambleCandidate} candidate 
     * @returns {string}
     */
    static getCandidateSignature(candidate) {
        if (!candidate) return "";
        const rotUp = candidate.startingRotation?.up || "";
        const rotFront = candidate.startingRotation?.front || "";
        const movesStr = candidate.scramble ? candidate.scramble.join(" ") : "";
        return `${candidate.startingGrip || ""}|${rotUp}|${rotFront}|${movesStr}`;
    }

    /**
     * Helper to insert a candidate into a tied-cost candidate array with deduplication and capacity limit.
     * @param {ScrambleCandidate[]} targetList 
     * @param {ScrambleCandidate} candidate 
     * @param {number} [maxCapacity] 
     */
    static addCandidate(targetList, candidate, maxCapacity = 50) {
        if (targetList.length === 0 || candidate.cost < targetList[0].cost) {
            targetList.length = 0;
            targetList.push(candidate);
        } 
        else if (candidate.cost === targetList[0].cost) {
            if (targetList.length < maxCapacity) {
                const sig = ScrambleOptimizer.getCandidateSignature(candidate);
                const isDup = targetList.some(c => ScrambleOptimizer.getCandidateSignature(c) === sig);
                if (!isDup) targetList.push(candidate);
            }
        }
    }

    /**
     * @param {ExecutionEvaluator} evaluator Evaluator for grip transitions and execution costs
     * @param {(() => Promise<void> | void) | null} [callback] Function to call when an orientation optimization finishes
     */
    constructor(evaluator, callback = null) {
        /** @type {ExecutionEvaluator} Evaluator for grip transitions and execution costs */
        this.evaluator = evaluator;
        /** @type {((() => Promise<void> | void)) | null} Function to call when an orientation optimization finishes */
        this.callback = callback || null;
        /** @type {RunOptions} Active run options for scramble search */
        this.options = { ...defaultRunOptions };
        /** @type {number} The current number of iterations from search */
        this.iterations = 0;
        /** @type {Map<number, number> | null} Amount of found scrambles with a specific cost */
        this.distribution = null;
        /** @type {ScrambleCandidate[]} All candidate scrambles tied for lowest cost */
        this.candidates = [];
        /** @type {OrientationResultInfo[] | null} */
        this.orientationInfo = null;
        /** @type {Float64Array} Lowest cost found so far to reach each (logical index, grip, orientation) search state */
        this.memo = new Float64Array(0);
        /** @type {MoveVariant[]} */
        this.variants = [];
        /** @type {Map<number, number>} Index in variants of each distinct combination of move properties */
        this.variantIndexes = new Map();
        /** @type {Int32Array} Variant of the rotation move for each rotation (-1 for rotations that can't be injected) */
        this.rotationVariants = new Int32Array(ROTATION_COUNT);
        /** @type {number[]} Rotations the search may inject before a move, in the order they are tried */
        this.injectedRotations = [];
        /** @type {Uint8Array} Whether each rotation can be performed from each grip, at grip * ROTATION_COUNT + rotation */
        this.canRotate = new Uint8Array(0);
        // Scratch space for the partition search currently running
        /** @type {Int8Array} Alpha of each move before any rotation of the search is applied */
        this.baseAlphas = new Int8Array(0);
        /** @type {Int32Array} Variants of each move as it is, as a wide move, as a prime move, and as both; at move * 4 + kind, -1 when not allowed */
        this.baseVariants = new Int32Array(0);
        /** @type {Int32Array} Variant of each move executed so far by the search */
        this.pathVariants = new Int32Array(0);
        /** @type {Int8Array} Alpha of each move executed so far by the search */
        this.pathAlphas = new Int8Array(0);
        /** @type {Transition[]} Transition of each move executed so far by the search */
        this.pathTransitions = [];
    }

    /**
     * @param {Move[]} moves 
     * @returns {Move[]}
     */
    static copyScramble(moves) {
        return moves.map(move => move.clone());
    }

    /**
     * @param {Move[]} scramble 
     * @returns {string}
     */
    static getScrambleString(scramble) {
        return scramble.map(m => m.toString()).join(" ");
    }

    /**
     * Adds a scramble cost to the current distribution
     * @param {number} cost 
     */
    recordCost(cost) {
        if (!this.distribution) return;
        const rounded = Math.round(cost * 2) / 2;
        this.distribution.set(rounded, (this.distribution.get(rounded) || 0) + 1);
    }

    /**
     * Resets everything the search caches between runs, since it depends on the run options.
     * @param {number} scrambleLength Number of moves in the scramble being optimized
     */
    initSearchTables(scrambleLength) {
        const gripCount = this.evaluator.allGripKeys.length;

        this.memo = new Float64Array(this.options.memoize ? (scrambleLength + 1) * gripCount * ORIENTATIONS.length : 0).fill(Infinity);

        this.variants = [];
        this.variantIndexes = new Map();
        this.rotationVariants.fill(-1);
        for (const rotKey of Object.values(INJECTABLE_ROTATIONS).flat()) {
            this.rotationVariants[ROTATION_INDEXES[rotKey]] = this.getVariantIndex(0, rotKey.includes("'"), rotKey.includes("2"), false, true, false);
        }

        this.injectedRotations = [];
        if (this.options.injectZRotations) this.injectedRotations.push(...INJECTABLE_ROTATIONS.z.map(rotKey => ROTATION_INDEXES[rotKey]));
        if (this.options.injectXRotations) this.injectedRotations.push(...INJECTABLE_ROTATIONS.x.map(rotKey => ROTATION_INDEXES[rotKey]));
        if (this.options.injectYRotations) this.injectedRotations.push(...INJECTABLE_ROTATIONS.y.map(rotKey => ROTATION_INDEXES[rotKey]));

        this.canRotate = new Uint8Array(gripCount * ROTATION_COUNT);
        for (let grip = 0; grip < gripCount; grip++) {
            for (let rot = 0; rot < ROTATION_COUNT; rot++) {
                this.canRotate[grip * ROTATION_COUNT + rot] = Number(this.evaluator.getTransition(this.evaluator.allGripKeys[grip], ROTATION_KEYS[rot]) !== null);
            }
        }
    }

    /**
     * @param {number} sliceNum
     * @param {boolean} isPrime
     * @param {boolean} isDouble
     * @param {boolean} isInvertedSlice
     * @param {boolean} isRotation
     * @param {boolean} isMiddle
     * @returns {number} Index in this.variants of the variant with these properties
     */
    getVariantIndex(sliceNum, isPrime, isDouble, isInvertedSlice, isRotation, isMiddle) {
        const key = ((((sliceNum * 2 + Number(isPrime)) * 2 + Number(isDouble)) * 2 + Number(isInvertedSlice)) * 2 + Number(isRotation)) * 2 + Number(isMiddle);
        let index = this.variantIndexes.get(key);
        if (index === undefined) {
            index = this.variants.length;
            this.variants.push({
                sliceNum, isPrime, isDouble, isInvertedSlice, isRotation, isMiddle,
                options: new Array(ALPHA_COUNT * this.evaluator.allGripKeys.length).fill(undefined)
            });
            this.variantIndexes.set(key, index);
        }
        return index;
    }

    /**
     * Gets the ways to execute a move from a grip: directly, and/or after a regrip.
     * @param {number} variantIndex
     * @param {number} alphaIndex
     * @param {number} gripIndex
     * @returns {StepOption[]}
     */
    getStepOptions(variantIndex, alphaIndex, gripIndex) {
        const variant = this.variants[variantIndex];
        const slot = alphaIndex * this.evaluator.allGripKeys.length + gripIndex;
        const cached = variant.options[slot];
        if (cached) return cached;

        const moved = new Move(ALPHAS[alphaIndex], variant.isPrime, variant.isDouble, variant.isRotation, variant.isInvertedSlice, variant.isMiddle, variant.sliceNum);
        const grip = this.evaluator.allGripKeys[gripIndex];
        /** @type {ExecutionStep[]} */
        const steps = [];

        const direct = this.evaluator.getDirectStep(grip, moved, this.options.cubeSize);
        if (direct) {
            steps.push(direct);
        }
        if (!direct || this.options.searchRegrips) {
            steps.push(...this.evaluator.getRegripOptions(grip, moved, this.options.cubeSize, this.options.maxRegripBranches ?? 2));
        }

        const options = steps.map(step => ({ transition: step.transition, nextGrip: this.evaluator.getGripIndex(step.nextGrip), cost: step.cost }));
        variant.options[slot] = options;
        return options;
    }

    /**
     * Describes the moves a partition search will consider replacing, so the search itself only handles integers.
     * @param {Move[]} moves The scramble being searched
     * @param {number} startIndex
     * @param {number} endIndex
     */
    prepareSearch(moves, startIndex, endIndex) {
        if (this.baseAlphas.length < moves.length) {
            this.baseAlphas = new Int8Array(moves.length);
            this.baseVariants = new Int32Array(moves.length * 4);
        }
        const maxPathLength = (endIndex - startIndex) * 2;
        if (this.pathVariants.length < maxPathLength) {
            this.pathVariants = new Int32Array(maxPathLength);
            this.pathAlphas = new Int8Array(maxPathLength);
        }

        for (let i = startIndex; i < endIndex; i++) {
            const move = moves[i];
            const alpha = ALPHA_INDEXES[move.alpha];
            if (alpha === undefined || alpha >= FACE_COUNT) {
                throw new Error(`Search expects scramble of face moves, got ${move}`);
            }
            this.baseAlphas[i] = alpha;

            const { sliceNum, isPrime, isDouble, isInvertedSlice, isRotation, isMiddle } = move;
            const canWide = this.canWideReplace(move);
            this.baseVariants[i * 4] = this.getVariantIndex(sliceNum, isPrime, isDouble, isInvertedSlice, isRotation, isMiddle);
            this.baseVariants[i * 4 + 1] = canWide ? this.getVariantIndex(sliceNum, isPrime, isDouble, true, isRotation, isMiddle) : -1;
            this.baseVariants[i * 4 + 2] = isDouble ? this.getVariantIndex(sliceNum, !isPrime, isDouble, isInvertedSlice, isRotation, isMiddle) : -1;
            this.baseVariants[i * 4 + 3] = isDouble && canWide ? this.getVariantIndex(sliceNum, !isPrime, isDouble, true, isRotation, isMiddle) : -1;
        }
    }

    /**
     * Builds the full scramble for a finished search: the moves before the search, the moves chosen by it, and the untouched remainder transposed by the search's rotations
     * @param {SearchContext} ctx
     * @param {number} permutationIndex
     * @param {number} pathLength
     * @returns {Move[]}
     */
    buildScramble(ctx, permutationIndex, pathLength) {
        const chosen = [];
        for (let i = 0; i < pathLength; i++) {
            const { sliceNum, isPrime, isDouble, isInvertedSlice, isRotation, isMiddle } = this.variants[this.pathVariants[i]];
            const move = new Move(ALPHAS[this.pathAlphas[i]], isPrime, isDouble, isRotation, isInvertedSlice, isMiddle, sliceNum);
            move.transition = this.pathTransitions[i];
            chosen.push(move);
        }

        const tail = ScrambleOptimizer.copyScramble(ctx.moves.slice(ctx.endIndex));
        tail.forEach(move => move.transposeWith(PERMUTATIONS[permutationIndex]));

        return [...ScrambleOptimizer.copyScramble(ctx.moves.slice(0, ctx.startIndex)), ...chosen, ...tail];
    }

    /**
     * Depth first search over the ways to execute the moves of a partition, pruning branches that can't beat the best found.
     * Cube rotations are tracked as indexes into the tables in rotations.js; the moves chosen so far are in the path arrays.
     * @param {SearchContext} ctx
     * @param {number} index Index in ctx.moves of the next move to execute
     * @param {number} logicalIndex Logical index in original scramble
     * @param {number} gripIndex Current grip
     * @param {number} cost Cost so far
     * @param {number} orientationIndex Current orientation of the cube
     * @param {number} permutationIndex Net rotation applied so far to the moves from `index` onward
     * @param {number} pathLength Number of moves executed so far since the search began
     */
    search(ctx, index, logicalIndex, gripIndex, cost, orientationIndex, permutationIndex, pathLength) {
        const options = this.options;
        if (this.iterations >= options.maxIterations) {
            return;
        }
        if (this.isOverBound(ctx, cost)) {
            return;
        }
        if (index >= ctx.endIndex) {
            this.finishSearch(ctx, logicalIndex, gripIndex, cost, orientationIndex, permutationIndex, pathLength);
            return;
        }
        if (options.memoize) {
            const key = (logicalIndex * this.evaluator.allGripKeys.length + gripIndex) * ORIENTATIONS.length + orientationIndex;
            if (this.memo[key] + options.depth <= cost) {
                return;
            }
            this.memo[key] = cost;
        }

        this.iterations++;
        const alpha = PERMUTATION_FACE[permutationIndex * FACE_COUNT + this.baseAlphas[index]];
        const variants = this.baseVariants;

        // Normal branch
        this.branch(ctx, index, logicalIndex, gripIndex, cost, orientationIndex, permutationIndex, pathLength, variants[index * 4], alpha, -1);

        // Injected rotations (when the option for their axis is enabled)
        for (let i = 0; i < this.injectedRotations.length; i++) {
            const rotation = this.injectedRotations[i];
            if (this.canRotate[gripIndex * ROTATION_COUNT + rotation]) {
                this.branchWithInjectedRotation(ctx, index, logicalIndex, gripIndex, cost, orientationIndex, permutationIndex, pathLength, rotation);
            }
        }

        // wide variation (single-layer wide)
        const wideVariant = variants[index * 4 + 1];
        if (wideVariant >= 0) {
            this.branchWide(ctx, index, logicalIndex, gripIndex, cost, orientationIndex, permutationIndex, pathLength, wideVariant, alpha);
        }

        // prime variation for double (toggle R2 <-> R2')
        const primeVariant = variants[index * 4 + 2];
        if (primeVariant >= 0) {
            this.branch(ctx, index, logicalIndex, gripIndex, cost, orientationIndex, permutationIndex, pathLength, primeVariant, alpha, -1);

            // Combinations (prime + wide, prime + wideReplaceDouble, etc.)
            const primeWideVariant = variants[index * 4 + 3];
            if (primeWideVariant >= 0) {
                this.branchWide(ctx, index, logicalIndex, gripIndex, cost, orientationIndex, permutationIndex, pathLength, primeWideVariant, alpha);
            }
        }
    }

    /**
     * Checks if a branch costs too much to tie or beat the best found, within the search depth.
     * @param {SearchContext} ctx
     * @param {number} cost
     * @returns {boolean}
     */
    isOverBound(ctx, cost) {
        const options = this.options;
        if (cost > ctx.minCost + options.depth) {
            return true;
        }
        const bestCost = this.candidates[0]?.cost ?? Infinity;
        return options.pruneStartingOrientations && cost > bestCost + options.depth;
    }

    /**
     * Continues the search from a wide version of the current move, which also rotates the cube.
     * @param {SearchContext} ctx
     * @param {number} index
     * @param {number} logicalIndex
     * @param {number} gripIndex
     * @param {number} cost
     * @param {number} orientationIndex
     * @param {number} permutationIndex
     * @param {number} pathLength
     * @param {number} variantIndex The wide variant of the current move
     * @param {number} alpha Alpha of the current move before it is made wide
     */
    branchWide(ctx, index, logicalIndex, gripIndex, cost, orientationIndex, permutationIndex, pathLength, variantIndex, alpha) {
        const wideAlpha = WIDE_OPPOSITE[alpha];
        const { isPrime, isDouble } = this.variants[variantIndex];
        const rotation = getWideRotation(wideAlpha, isPrime, isDouble);
        this.branch(ctx, index, logicalIndex, gripIndex, cost, orientationIndex, permutationIndex, pathLength, variantIndex, wideAlpha, rotation);
    }

    /**
     * Continues the search from executing the current move as a given variant, then rotating the cube.
     * @param {SearchContext} ctx
     * @param {number} index
     * @param {number} logicalIndex
     * @param {number} gripIndex
     * @param {number} cost
     * @param {number} orientationIndex
     * @param {number} permutationIndex
     * @param {number} pathLength
     * @param {number} variantIndex The variant of the move to execute
     * @param {number} alpha Alpha of the move to execute
     * @param {number} rotation Rotation the move applies to the cube afterward, or -1 for none
     */
    branch(ctx, index, logicalIndex, gripIndex, cost, orientationIndex, permutationIndex, pathLength, variantIndex, alpha, rotation) {
        const newOrientation = rotation < 0 ? orientationIndex : ORIENTATION_AFTER[orientationIndex * ROTATION_COUNT + rotation];
        const newPermutation = rotation < 0 ? permutationIndex : PERMUTATION_AFTER[permutationIndex * ROTATION_COUNT + rotation];

        const stepOptions = this.getStepOptions(variantIndex, alpha, gripIndex);
        for (let i = 0; i < stepOptions.length; i++) {
            const option = stepOptions[i];
            // Same check search makes on entry; skipping the call here avoids its overhead for the many children that fail it
            if (this.isOverBound(ctx, cost + option.cost)) {
                continue;
            }
            this.pathVariants[pathLength] = variantIndex;
            this.pathAlphas[pathLength] = alpha;
            this.pathTransitions[pathLength] = option.transition;
            this.search(ctx, index + 1, logicalIndex + 1, option.nextGrip, cost + option.cost, newOrientation, newPermutation, pathLength + 1);
        }
    }

    /**
     * Continues the search from performing a rotation before the current move, which is then executed in the new orientation.
     * @param {SearchContext} ctx
     * @param {number} index
     * @param {number} logicalIndex
     * @param {number} gripIndex
     * @param {number} cost
     * @param {number} orientationIndex
     * @param {number} permutationIndex
     * @param {number} pathLength
     * @param {number} rotation The rotation to inject
     */
    branchWithInjectedRotation(ctx, index, logicalIndex, gripIndex, cost, orientationIndex, permutationIndex, pathLength, rotation) {
        const newOrientation = ORIENTATION_AFTER[orientationIndex * ROTATION_COUNT + rotation];
        const newPermutation = PERMUTATION_AFTER[permutationIndex * ROTATION_COUNT + rotation];
        const rotationVariant = this.rotationVariants[rotation];
        const rotationAlpha = ALPHA_INDEXES[ROTATION_KEYS[rotation][0]];
        const moveVariant = this.baseVariants[index * 4];
        const rotatedAlpha = PERMUTATION_FACE[newPermutation * FACE_COUNT + this.baseAlphas[index]];

        const rotationOptions = this.getStepOptions(rotationVariant, rotationAlpha, gripIndex);
        for (let i = 0; i < rotationOptions.length; i++) {
            const rotationOption = rotationOptions[i];
            this.pathVariants[pathLength] = rotationVariant;
            this.pathAlphas[pathLength] = rotationAlpha;
            this.pathTransitions[pathLength] = rotationOption.transition;
            this.branch(ctx, index, logicalIndex, rotationOption.nextGrip, cost + rotationOption.cost, newOrientation, newPermutation, pathLength + 1, moveVariant, rotatedAlpha, -1);
        }
    }

    /**
     * Records a completed partition search if it ties or beats the best found.
     * @param {SearchContext} ctx
     * @param {number} logicalIndex
     * @param {number} gripIndex
     * @param {number} cost
     * @param {number} orientationIndex
     * @param {number} permutationIndex
     * @param {number} pathLength
     */
    finishSearch(ctx, logicalIndex, gripIndex, cost, orientationIndex, permutationIndex, pathLength) {
        if (ctx.minResults.length === 0 || cost <= ctx.minResults[0].cost) {
            /** @type {ScrambleCandidate} */
            const candidateItem = {
                scramble: this.buildScramble(ctx, permutationIndex, pathLength),
                cost,
                startingRotation: { up: null, front: null },
                startingGrip: ctx.startGrip,
                finalOrientation: { ...ORIENTATIONS[orientationIndex] },
                partitionBoundaries: [],
                finalGrip: this.evaluator.allGripKeys[gripIndex],
                logicalIndex
            };
            ScrambleOptimizer.addCandidate(ctx.minResults, candidateItem, this.options.maxCapacity);
            ctx.minCost = ctx.minResults[0].cost;
        }
        this.recordCost(cost);
    }

    /**
     * Helper checking if wide replace can be applied to a move
     * @param {Move} move 
     * @returns {boolean}
     */
    canWideReplace(move) {
        return (this.options.wideReplace !== false) && move && (this.options.cubeSize !== 2 * (move.sliceNum || 1)) && !move.isInvertedSlice && !move.isMiddle && !move.isRotation;
    }

    /**
     * Runs sequential partition search for a given initial scramble, starting grip, and orientation
     * @param {Move[]} scramble 
     * @param {GripState} startGrip 
     * @param {number} initialCost 
     * @param {Orientation} orientation 
     * @param {number} partitionLength
     */
    runPartitionSequence(scramble, startGrip, initialCost, orientation, partitionLength) {
        /** @type {ScrambleCandidate[]} */
        let currCandidates = [{
            scramble: ScrambleOptimizer.copyScramble(scramble),
            cost: initialCost,
            startingRotation: { up: null, front: null },
            startingGrip: startGrip,
            finalOrientation: { ...orientation },
            partitionBoundaries: [],
            finalGrip: startGrip,
            physicalOffset: 0,
            logicalIndex: 0
        }];

        const scrambleLen = scramble.length;

        while (currCandidates.some(c => (c.logicalIndex || 0) < scrambleLen)) {
            /** @type {ScrambleCandidate[]} */
            let nextCandidates = [];

            for (const cand of currCandidates) {
                const candLogicalStart = cand.logicalIndex || 0;
                if (candLogicalStart >= scrambleLen) {
                    ScrambleOptimizer.addCandidate(nextCandidates, cand, this.options.maxCapacity);
                    continue;
                }

                const currentGrip = cand.finalGrip;
                const candLogicalEnd = Math.min(candLogicalStart + partitionLength, scrambleLen);
                const offset = cand.physicalOffset || 0;
                const physicalStartIndex = candLogicalStart + offset;
                const physicalEndIndex = candLogicalEnd + offset;
                const origLen = cand.scramble.length;

                /** @type {SearchContext} */
                const ctx = {
                    moves: cand.scramble,
                    startIndex: physicalStartIndex,
                    endIndex: physicalEndIndex,
                    startGrip,
                    minCost: Infinity,
                    minResults: []
                };

                this.prepareSearch(cand.scramble, physicalStartIndex, physicalEndIndex);
                this.search(ctx, physicalStartIndex, candLogicalStart, this.evaluator.getGripIndex(currentGrip), cand.cost, getOrientationIndex(cand.finalOrientation), 0, 0);

                if (!ctx.minResults || ctx.minResults.length === 0) {
                    continue;
                }

                for (const res of ctx.minResults) {
                    const addedOffset = res.scramble.length - origLen;
                    const totalOffset = offset + addedOffset;
                    const resLogicalIndex = res.logicalIndex ?? candLogicalEnd;
                    const actualPhysicalEndIndex = resLogicalIndex + totalOffset;
                    const newBoundaries = [ ...(cand.partitionBoundaries || []) ];
                    if (actualPhysicalEndIndex < res.scramble.length) {
                        newBoundaries.push(actualPhysicalEndIndex);
                    }

                    /** @type {ScrambleCandidate} */
                    const candidateItem = {
                        scramble: res.scramble,
                        cost: res.cost,
                        startingRotation: cand.startingRotation || { up: null, front: null },
                        startingGrip: startGrip,
                        finalOrientation: res.finalOrientation,
                        partitionBoundaries: newBoundaries,
                        finalGrip: res.finalGrip,
                        physicalOffset: totalOffset,
                        logicalIndex: resLogicalIndex
                    };

                    ScrambleOptimizer.addCandidate(nextCandidates, candidateItem, this.options.maxCapacity);
                }
            }

            if (nextCandidates.length === 0) {
                return null;
            }

            currCandidates = nextCandidates;
        }

        return currCandidates;
    }

    /**
     * Runs the partition search for all orientations of the cube to find the best one
     * @param {ParseResult} parseResult The input parse result
     * @param {Partial<RunOptions>} [options] Options for execution
     */
    async optimize(parseResult, options = {}) {
        if (!parseResult || !Array.isArray(parseResult.moves)) {
            throw new Error("ScrambleOptimizer.optimize requires a valid ParseResult object");
        }

        const rawScramble = parseResult.moves;
        this.originalFinalOrientation = getFinalOrientation(rawScramble);
        const preprocessedScramble = normalizeScramble(rawScramble);

        const cubeSize = options?.cubeSize || detectCubeSize(preprocessedScramble);

        this.options = { ...defaultRunOptions, ...options, cubeSize };
        this.candidates = [];
        this.distribution = new Map();
        this.orientationInfo = [];
        this.iterations = 0;
        this.initSearchTables(preprocessedScramble.length);

        const candidateGrips = this.evaluator.allGripKeys;
        const partitionLength = Math.max(0, this.options.partitionLength || 0);

        // Check for optimization across all 24 orientations
        for (const top_rot of Move.TOP_ROTATIONS) {
            for (const front_rot of Move.FRONT_ROTATIONS) {
                const rotatedScramble = ScrambleOptimizer.copyScramble(preprocessedScramble);
                /** @type {Orientation} */
                const newOrientation = { up: "U", front: "F" };

                // transpose all moves according to the starting rotation
                if (top_rot !== null) {
                    rotatedScramble.forEach(move => move.transpose(top_rot));
                    Move.transposeOrientation(newOrientation, top_rot);
                }
                if (front_rot !== null) {
                    rotatedScramble.forEach(move => move.transpose(front_rot));
                    Move.transposeOrientation(newOrientation, front_rot);
                }

                let bestGripCost = Infinity;
                let bestGripStartingGrip = candidateGrips[0] || "F F";

                const prevIterations = this.iterations;

                for (const startGrip of candidateGrips) {
                    const initialCost = this.evaluator.config.grip[startGrip] || 0;

                    const effectivePartition = (partitionLength > 0) ? partitionLength : rotatedScramble.length;
                    const results = this.runPartitionSequence(rotatedScramble, startGrip, initialCost, newOrientation, effectivePartition);
                    if (results && results.length > 0) {
                        for (const res of results) {
                            if (res.cost < bestGripCost) {
                                bestGripCost = res.cost;
                                bestGripStartingGrip = startGrip;
                            }
                            res.startingRotation = { up: top_rot, front: front_rot };
                            ScrambleOptimizer.addCandidate(this.candidates, res, this.options.maxCapacity);
                        }
                    }
                }

                const orientationIterations = this.iterations - prevIterations;

                if (this.orientationInfo) {
                    this.orientationInfo.push({
                        startingRotation: { up: top_rot, front: front_rot }, 
                        startingGrip: bestGripStartingGrip,
                        cost: bestGripCost, 
                        iterations: orientationIterations,
                        maxed: this.iterations >= this.options.maxIterations,
                    });
                }

                if(this.callback)
                    await this.callback();

                if(!this.options.searchStartingOrientations)
                    return;
            }
        }
    }

    /**
     * @param {ScrambleCandidate} [candidate]
     * @param {FormatOptions} [formatOptions]
     * @returns {ScrambleBreakdownEntry[]}
     */
    analyzeCandidate(candidate = this.candidates[0], formatOptions = defaultFormatOptions) {
        if (!candidate || !candidate.scramble) return [];

        const boundaries = candidate.partitionBoundaries || [];
        let totalCost = 0;

        /** @type {ScrambleBreakdownEntry[]} */
        const breakdown = [];

        for (let i = 0; i < candidate.scramble.length; i++) {
            const move = candidate.scramble[i];
            const transition = move.transition;
            if (!transition) {
                break;
            }

            const costBreakdown = {};
            const addedCost = this.evaluator.computeCost(transition, move, this.options.cubeSize, transition.regripFrom, costBreakdown);

            breakdown.push({
                move: /** @type {MoveStr} */ (move.toString(formatOptions.wedgeNotation, this.options.cubeSize)), 
                transition, 
                addedCost,
                costBreakdown,
                isPartitionBoundary: i > 0 && boundaries.includes(i)
            });

            totalCost += addedCost;
        }

        return breakdown;
    }

    /**
     * @param {ScrambleCandidate} [candidate]
     * @param {FormatOptions} [options]
     * @returns {string}
     */
    formatCandidate(candidate = this.candidates[0], options = defaultFormatOptions) {
        if (!candidate || !candidate.scramble) return "";

        const formatGrip = (/** @type {GripState} */ g) => `[${g.replace(" ", "/")}]`;

        const { topColor, frontColor } = getOrientationColors(candidate.startingRotation, options.colorScheme);
        const orientationColorStr = topColor && frontColor ? `${topColor} U ${frontColor} F` : "";
        const rotations = options.showOrientationColors 
            ? (orientationColorStr ? [`[${orientationColorStr}]`] : [])
            : [candidate.startingRotation?.up, candidate.startingRotation?.front].filter(Boolean);

        const startGrip = options.showGrips && candidate.startingGrip ? [formatGrip(candidate.startingGrip)] : [];
        const breakdown = this.analyzeCandidate(candidate, options);

        const moves = [];
        for (let i = 0; i < candidate.scramble.length; i++) {
            if (options.showBoundaries && breakdown[i]?.isPartitionBoundary) {
                moves.push("|");
            }
            const move = candidate.scramble[i];
            const transition = breakdown[i]?.transition;
            const moveStr = move.toString(options.wedgeNotation, this.options.cubeSize);
            if (options.showGrips && transition?.regripPrompt) {
                moves.push(formatGrip(transition.regripPrompt));
            }
            moves.push(moveStr);
        }

        const solverStartOrientation = { up: /** @type {FaceStr} */ ("U"), front: /** @type {FaceStr} */ ("F") };
        if (candidate.startingRotation?.up) Move.transposeOrientation(solverStartOrientation, candidate.startingRotation.up);
        if (candidate.startingRotation?.front) Move.transposeOrientation(solverStartOrientation, candidate.startingRotation.front);

        const solverFinalOrientation = getFinalOrientation(candidate.scramble, solverStartOrientation);
        const restoringRot = getRestoringRotation(solverFinalOrientation, this.originalFinalOrientation);
        const endRotations = options.reorient
            ? [restoringRot.up, restoringRot.front].filter(Boolean)
            : [];

        return [ ...rotations, ...startGrip, ...moves, ...endRotations ].join(" ");
    }
}