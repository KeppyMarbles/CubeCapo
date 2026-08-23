import { defaultFormatOptions, defaultRunOptions } from "./defaults.js";
import { Move } from "./move.js";
import { getOrientationColors, getRestoringRotation, detectCubeSize } from "./util.js";
/** @import { ExecutionEvaluator } from "./execution.js" */
/** @import { Orientation, GripState, RunOptions, FormatOptions, OrientationResultInfo, ScrambleBreakdownEntry, RotationStr, ScrambleCandidate, FaceStr, MoveStr, ExecutionStep, TransformDescriptor, ParseResult, AxisStr } from "../types.js" */

/**
 * @typedef {Object} SearchContext
 * @property {number} minCost
 * @property {ScrambleCandidate[]} minResults
 * @property {Move[] | null} minScramble
 * @property {GripState} minStartingGrip
 * @property {GripState} minFinalGrip
 * @property {Orientation | null} minFinalOrientation
 */

export class ScrambleOptimizer {
    /** @type {TransformDescriptor} */
    static IDENTITY_DESCRIPTOR = Object.freeze({ logicalSkip: 1, physicalCount: 1, apply: () => {} });

    /** @type {TransformDescriptor} */
    static WIDE_DESCRIPTOR = Object.freeze({ logicalSkip: 1, physicalCount: 1, apply: (arr, idx, or) => ScrambleOptimizer.wideReplace(arr, idx, or) });

    /** @type {TransformDescriptor} */
    static PRIME_DESCRIPTOR = Object.freeze({ logicalSkip: 1, physicalCount: 1, apply: (arr, idx, or) => ScrambleOptimizer.primeReplace(arr, idx, or) });

    /** @type {TransformDescriptor} */
    static PRIME_WIDE_DESCRIPTOR = Object.freeze({ 
        logicalSkip: 1, 
        physicalCount: 1, 
        apply: (arr, idx, or) => { 
            ScrambleOptimizer.primeReplace(arr, idx, or); 
            ScrambleOptimizer.wideReplace(arr, idx, or); 
        } 
    });

    /**
     * @param {RotationStr} rotKey 
     * @returns {TransformDescriptor}
     */
    static makeRotationInjectDescriptor(rotKey) {
        return Object.freeze({ logicalSkip: 1, physicalCount: 2, apply: (clone, index, newOrientation) => ScrambleOptimizer.injectRotation(clone, index, newOrientation, rotKey) });
    }

    static Z_INJECT_DESCRIPTOR = ScrambleOptimizer.makeRotationInjectDescriptor("z");
    static Z_PRIME_INJECT_DESCRIPTOR = ScrambleOptimizer.makeRotationInjectDescriptor("z'");
    static Z2_INJECT_DESCRIPTOR = ScrambleOptimizer.makeRotationInjectDescriptor("z2");

    static X_INJECT_DESCRIPTOR = ScrambleOptimizer.makeRotationInjectDescriptor("x");
    static X_PRIME_INJECT_DESCRIPTOR = ScrambleOptimizer.makeRotationInjectDescriptor("x'");
    static X2_INJECT_DESCRIPTOR = ScrambleOptimizer.makeRotationInjectDescriptor("x2");

    /**
     * Computes a unique signature string for deduplicating scramble candidates.
     * @param {ScrambleCandidate} candidate 
     * @returns {string}
     */
    static getCandidateSignature(candidate) {
        if (!candidate) return "";
        const rotUp = candidate.rotation?.up || "";
        const rotFront = candidate.rotation?.front || "";
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
     * @param {ExecutionEvaluator} execution Evaluator for grip transitions and execution costs
     * @param {(() => Promise<void> | void) | null} [callback] Function to call when a rotation optimization finishes
     */
    constructor(execution, callback = null) {
        /** @type {ExecutionEvaluator} Evaluator for grip transitions and execution costs */
        this.execution = execution;
        /** @type {((() => Promise<void> | void)) | null} Function to call when a rotation optimization finishes */
        this.callback = callback || null;
        /** @type {RunOptions} Active run options for scramble search */
        this.options = { ...defaultRunOptions };
        /** @type {number} The current number of iterations from bruteforceOptimize */
        this.iterations = 0;
        /** @type {Map<number, number> | null} Amount of found scrambles with a specific cost */
        this.distribution = null;
        /** @type {ScrambleCandidate[]} All candidate scrambles tied for lowest cost */
        this.candidates = [];
        /** @type {OrientationResultInfo[] | null} */
        this.rotationInfo = null;
        /** @type {Map<string, number>} Memoization for all orientations */
        this.memo = new Map();
    }

    /**
     * Applies rotation to all moves after `index` and updates orientation.
     * @param {Move[]} moves 
     * @param {number} index 
     * @param {Orientation} orientation 
     * @param {RotationStr} rotKey 
     */
    static applyRotation(moves, index, orientation, rotKey) {
        if (!rotKey) return;
        Move.transposeOrientation(orientation, rotKey);
        for (let i = index + 1; i < moves.length; i++) {
            moves[i].transpose(rotKey);
        }
    }

    /**
     * Inserts a rotation move at a given index and transposes subsequent moves + orientation
     * @param {Move[]} moves 
     * @param {number} index 
     * @param {Orientation} orientation 
     * @param {RotationStr} rotKey 
     */
    static injectRotation(moves, index, orientation, rotKey) {
        if (!rotKey) return;
        const rotMove = new Move(/** @type {AxisStr} */ (rotKey[0]), rotKey.includes("'"), rotKey.includes("2"), true);
        moves.splice(index, 0, rotMove);
        ScrambleOptimizer.applyRotation(moves, index, orientation, rotKey);
    }

    /**
     * Changes the move at a given index to a wide move and updates the orientation
     * @param {Move[]} moves 
     * @param {number} index 
     * @param {Orientation} orientation 
     */
    static wideReplace(moves, index, orientation) {
        const rotKey = moves[index].toWide().getAssociatedRotation();
        if (rotKey) ScrambleOptimizer.applyRotation(moves, index, orientation, rotKey);
    }

    /**
     * Changes the move at a given index to a prime move (assumes given move is double)
     * @param {Move[]} moves 
     * @param {number} index 
     * @param {Orientation} orientation 
     */
    static primeReplace(moves, index, orientation) {
        moves[index].invert();
    }

    /**
     * @param {Move[]} moves 
     * @returns {Move[]}
     */
    static copyScramble(moves) {
        return moves.map(move => move.clone());
    }

    /**
     * Calculates the resulting orientation after applying a sequence of moves (including rotations and wide moves)
     * starting from an initial orientation.
     * @param {Move[]} moves 
     * @param {Orientation} [initialOrientation] 
     * @returns {Orientation}
     */
    static getFinalOrientation(moves, initialOrientation = { up: "U", front: "F" }) {
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
     * @param {Move[]} moves 
     * @param {number} index Physical index in moves array
     * @param {number} logicalIndex Logical index in original scramble
     * @param {GripState} currentGrip 
     * @param {number} currentCost 
     * @param {Orientation} orientation 
     * @param {GripState} [startGrip]
     * @param {number} [endIndex]
     * @param {SearchContext} [ctx]
     */
    bruteforceOptimize(moves, index, logicalIndex, currentGrip, currentCost, orientation, startGrip = "F F", endIndex = moves.length, ctx) {
        if (this.iterations >= this.options.maxIterations) {
            return;
        }
        const bestCost = this.candidates[0]?.cost ?? Infinity;
        if (this.options.pruneRotations && currentCost > bestCost + this.options.depth) {
            return;
        }
        if (ctx && currentCost > ctx.minCost + this.options.depth) {
            return;
        }
        if (index >= endIndex) {
            if (ctx) {
                /** @type {ScrambleCandidate} */
                const candidateItem = {
                    scramble: ScrambleOptimizer.copyScramble(moves),
                    cost: currentCost,
                    rotation: { up: null, front: null },
                    startingGrip: startGrip,
                    finalOrientation: { ...orientation },
                    partitionBoundaries: [],
                    finalGrip: currentGrip,
                    logicalIndex: logicalIndex
                };
                ScrambleOptimizer.addCandidate(ctx.minResults, candidateItem, this.options.maxCapacity);
                ctx.minCost = ctx.minResults[0].cost;
            }
            this.recordCost(currentCost);
            return;
        }
        if (this.options.memoize) {
            const key = `${logicalIndex}|${currentGrip}|${orientation.up}${orientation.front}`;
            if ((this.memo.get(key) ?? Infinity) + this.options.depth <= currentCost) 
                return;
            this.memo.set(key, currentCost);
        }

        /**
         * Create a new branch with a copied scramble using a TransformDescriptor
         * @param {TransformDescriptor} descriptor 
         */
        const branchWith = (descriptor) => {
            const clone = ScrambleOptimizer.copyScramble(moves);
            const newOrientation = { ...orientation };
            descriptor.apply(clone, index, newOrientation);

            const delta = descriptor.physicalCount - descriptor.logicalSkip;
            const newEndIndex = endIndex + delta;
            const newLogicalIndex = logicalIndex + descriptor.logicalSkip;
            const physicalEnd = index + descriptor.physicalCount;

            /**
             * Evaluates direct move execution or candidate regrips at a specific scramble index.
             * @param {number} idx Index of the move in clone
             * @param {GripState} cGrip Current grip state
             * @param {number} cCost Cumulative cost up to this move
             */
            const evaluateMoveAt = (idx, cGrip, cCost) => {
                const moved = clone[idx];
                /** @type {ExecutionStep[]} */
                const branches = [];

                const direct = this.execution.getDirectStep(cGrip, moved, this.options.cubeSize);
                if (direct) {
                    branches.push({
                        transition: direct.transition,
                        nextGrip: direct.nextGrip,
                        cost: cCost + direct.cost
                    });
                }

                if (!direct || this.options.searchRegrips) {
                    const regripOptions = this.execution.getRegripOptions(cGrip, moved, this.options.cubeSize, this.options.maxRegripBranches ?? 2);
                    for (let i = 0; i < regripOptions.length; i++) {
                        const opt = regripOptions[i];
                        branches.push({
                            transition: opt.transition,
                            nextGrip: opt.nextGrip,
                            cost: cCost + opt.cost
                        });
                    }
                }

                return branches;
            };

            /**
             * Recursively evaluates candidate branches for multi-move sequence variations.
             * @param {number} subIdx Current index in clone
             * @param {GripState} cGrip Current grip state
             * @param {number} cCost Cumulative cost
             */
            const evaluateSequenceBranch = (subIdx, cGrip, cCost) => {
                if (subIdx >= physicalEnd) {
                    this.bruteforceOptimize(clone, subIdx, newLogicalIndex, cGrip, cCost, newOrientation, startGrip, newEndIndex, ctx);
                    return;
                }
                const branches = evaluateMoveAt(subIdx, cGrip, cCost);
                for (let i = 0; i < branches.length; i++) {
                    const b = branches[i];
                    clone[subIdx].transition = b.transition;
                    evaluateSequenceBranch(subIdx + 1, b.nextGrip, b.cost);
                }
            };

            evaluateSequenceBranch(index, currentGrip, currentCost);
        };

        this.iterations++;
        const move = moves[index];

        // Normal branch
        branchWith(ScrambleOptimizer.IDENTITY_DESCRIPTOR);

        // Injected Z rotations (when in F F grip and injectZRotations or injectRotations option is enabled)
        if (this.options.injectZRotations && currentGrip === "F F") {
            branchWith(ScrambleOptimizer.Z_INJECT_DESCRIPTOR);
            branchWith(ScrambleOptimizer.Z_PRIME_INJECT_DESCRIPTOR);
            branchWith(ScrambleOptimizer.Z2_INJECT_DESCRIPTOR);
        }

        // Injected X rotations (when injectXRotations option is enabled)
        if (this.options.injectXRotations) {
            if (this.execution.getTransition(currentGrip, "x")) branchWith(ScrambleOptimizer.X_INJECT_DESCRIPTOR);
            if (this.execution.getTransition(currentGrip, "x'")) branchWith(ScrambleOptimizer.X_PRIME_INJECT_DESCRIPTOR);
            if (this.execution.getTransition(currentGrip, "x2")) branchWith(ScrambleOptimizer.X2_INJECT_DESCRIPTOR);
        }

        const canWideReplace = this.canWideReplace(move);

        // wide variation (single-layer wide)
        if (canWideReplace)
            branchWith(ScrambleOptimizer.WIDE_DESCRIPTOR);

        // prime variation for double (toggle R2 <-> R2')
        if(move.isDouble) { 
            branchWith(ScrambleOptimizer.PRIME_DESCRIPTOR);

            // Combinations (prime + wide, prime + wideReplaceDouble, etc.)
            if (canWideReplace) {
                branchWith(ScrambleOptimizer.PRIME_WIDE_DESCRIPTOR);
            }
        }
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
            rotation: { up: null, front: null },
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
                    minCost: Infinity,
                    minResults: [],
                    minScramble: null,
                    minStartingGrip: startGrip,
                    minFinalGrip: currentGrip,
                    minFinalOrientation: null
                };

                this.bruteforceOptimize(cand.scramble, physicalStartIndex, candLogicalStart, currentGrip, cand.cost, cand.finalOrientation, startGrip, physicalEndIndex, ctx);

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
                        rotation: cand.rotation || { up: null, front: null },
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
     * Calls bruteforceOptimize for all orientations of the cube to find the best one
     * @param {ParseResult} parseResult The input parse result
     * @param {Partial<RunOptions>} [options] Options for execution
     */
    async optimize(parseResult, options = {}) {
        if (!parseResult || !Array.isArray(parseResult.moves)) {
            throw new Error("ScrambleOptimizer.optimize requires a valid ParseResult object");
        }

        /** @type {Orientation} */
        const orientation = {up: "U", front: "F"};
        const rawScramble = parseResult.moves;
        const preprocessedScramble = [];

        this.originalFinalOrientation = ScrambleOptimizer.getFinalOrientation(rawScramble);

        // Remove all orientation changes, wide moves, and slice moves in the input scramble
        const decompContainer = { faceMoves: [], rotation: null };

        for (let i = 0; i < rawScramble.length; i++) {
            const move = rawScramble[i];
            const { rotation } = move.decompose(decompContainer);
            if (rotation) {
                Move.transposeOrientation(orientation, rotation);
            }
        }
        for (let i = rawScramble.length - 1; i >= 0; i--) {
            const move = rawScramble[i];
            const { faceMoves, rotation } = move.decompose(decompContainer);
            if (rotation) {
                for (let j = 0; j < preprocessedScramble.length; j++) {
                    preprocessedScramble[j].transposeInverse(rotation);
                }
            }
            if (faceMoves) {
                for (let k = faceMoves.length - 1; k >= 0; k--) {
                    preprocessedScramble.unshift(faceMoves[k]);
                }
            }
        }

        const cubeSize = options?.cubeSize || detectCubeSize(preprocessedScramble);

        this.options = { ...defaultRunOptions, ...options, cubeSize };
        this.candidates = [];
        this.distribution = new Map();
        this.rotationInfo = [];
        this.memo = new Map();
        this.iterations = 0;

        const candidateGrips = this.execution.allGripKeys;
        const partitionLength = Math.max(0, this.options.partitionLength || 0);

        // Check for optimization across all 24 orientations
        for (const top_rot of Move.TOP_ROTATIONS) {
            for (const front_rot of Move.FRONT_ROTATIONS) {
                const rotatedScramble = ScrambleOptimizer.copyScramble(preprocessedScramble);
                const newOrientation = { ...orientation };

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
                    const initialCost = this.execution.config.grip[startGrip] || 0;

                    const effectivePartition = (partitionLength > 0) ? partitionLength : rotatedScramble.length;
                    const results = this.runPartitionSequence(rotatedScramble, startGrip, initialCost, newOrientation, effectivePartition);
                    if (results && results.length > 0) {
                        for (const res of results) {
                            if (res.cost < bestGripCost) {
                                bestGripCost = res.cost;
                                bestGripStartingGrip = startGrip;
                            }
                            res.rotation = { up: top_rot, front: front_rot };
                            ScrambleOptimizer.addCandidate(this.candidates, res, this.options.maxCapacity);
                        }
                    }
                }

                const orientationIterations = this.iterations - prevIterations;

                if (this.rotationInfo) {
                    this.rotationInfo.push({
                        rotation: { up: top_rot, front: front_rot }, 
                        startingGrip: bestGripStartingGrip,
                        cost: bestGripCost, 
                        iterations: orientationIterations,
                        maxed: this.iterations >= this.options.maxIterations,
                    });
                }

                if(this.callback)
                    await this.callback();

                if(!this.options.searchRotations)
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
            const addedCost = this.execution.computeCost(transition, move, this.options.cubeSize, transition.regripFrom, costBreakdown);

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

        const { topColor, frontColor } = getOrientationColors(candidate.rotation, options.colorScheme);
        const orientationColorStr = topColor && frontColor ? `${topColor} U ${frontColor} F` : "";
        const rotations = options.showOrientationColors 
            ? (orientationColorStr ? [`[${orientationColorStr}]`] : [])
            : [candidate.rotation?.up, candidate.rotation?.front].filter(Boolean);

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
        if (candidate.rotation?.up) Move.transposeOrientation(solverStartOrientation, candidate.rotation.up);
        if (candidate.rotation?.front) Move.transposeOrientation(solverStartOrientation, candidate.rotation.front);

        const solverFinalOrientation = ScrambleOptimizer.getFinalOrientation(candidate.scramble, solverStartOrientation);
        const restoringRot = getRestoringRotation(solverFinalOrientation, this.originalFinalOrientation);
        const endRotations = options.reorient
            ? [restoringRot.up, restoringRot.front].filter(Boolean)
            : [];

        return [ ...rotations, ...startGrip, ...moves, ...endRotations ].join(" ");
    }
}