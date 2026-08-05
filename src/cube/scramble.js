import { defaultFormatOptions, defaultRunOptions } from "./defaults.js";
import { Move } from "./move.js";
import { getOrientationColors, getRestoringRotation, detectCubeSize } from "./util.js";
/** @import { CostConfig, TransitionConfig, Orientation, GripState, MoveKey, Transition, RunOptions, FormatOptions, OrientationResultInfo, ScrambleBreakdownEntry, CostDetails, RotationStr, Rotation, ScrambleCandidate } from "../types.js" */

/** @typedef {(moves: Move[], index: number, orientation: Orientation) => void} MoveTransform */

/**
 * @typedef {Object} SearchContext
 * @property {number} minCost
 * @property {ScrambleCandidate[]} [minResults]
 * @property {Move[] | null} minScramble
 * @property {GripState} minStartingGrip
 * @property {GripState} minFinalGrip
 * @property {Orientation | null} minFinalOrientation
 * @property {Transition | null} minLastTransition
 */

export class ScrambleOptimizer {
    /** @type {readonly number[]} */
    static supportedSizes = Object.freeze([2, 3, 4, 5, 6, 7]);

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
     * 
     * @param {CostConfig} config 
     * @param {TransitionConfig} transitions
     * @param {(() => Promise<void> | void) | null} [callback]
     */
    constructor(config, transitions, callback = null) {
        /** @type {CostConfig} Cost config */
        this.config = config;
        /** @type {TransitionConfig} Transition config */
        this.transitions = transitions;
        /** @type {() => Promise<void> | void} Function to call when a rotation optimization finishes */
        this.callback = callback;
        /** @type {RunOptions} Active run options for scramble search */
        this.options = { ...defaultRunOptions };
        /** @type {number} The current number of iterations from bruteforceOptimize */
        this.iterations = 0;
        /** @type {Map<number, number>} Amount of found scrambles with a specific cost */
        this.distribution = null;
        /** @type {ScrambleCandidate[]} All candidate scrambles tied for lowest cost */
        this.candidates = [];
        /** @type {OrientationResultInfo[]} */
        this.rotationInfo = null;
        /** @type {Map<string, number>} Memoization for all orientations */
        this.memo = new Map();
        /** @type {GripState[]} Invariant list of grip keys */
        this.allGripKeys = Object.keys(this.config.grip);
        /** @type {Record<GripState, Partial<Record<MoveKey, Transition>>> | null} Cache for transitions */
        this.transitionCache = null;
        this.initTransitionCache();
    }

    /**
     * Pre-computes transition objects for fast O(1) lookups during optimization.
     */
    initTransitionCache() {
        if (!this.transitions) return;
        this.transitionCache = {};

        for (const grip of this.allGripKeys) {
            const cacheRow = {};
            const gripTrans = this.transitions[grip];

            // Standard face transitions
            if (gripTrans) {
                for (const moveKey in gripTrans) {
                    const ftType = gripTrans[moveKey];
                    if (ftType === undefined || ftType === null) continue;
                    const nextGrip = Move.computeNextGrip(grip, moveKey);
                    if (nextGrip) cacheRow[moveKey] = { next: nextGrip, type: ftType };
                }
            }

            // Full-cube X rotations (0 fingertrick penalty)
            for (const rotKey in Move.X_ROTATION_MAP) {
                const nextGrip = Move.computeNextGrip(grip, rotKey);
                if (nextGrip) cacheRow[rotKey] = { next: nextGrip, type: "" };
            }

            this.transitionCache[grip] = cacheRow;
        }
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
     * Changes the move at a given index to a wide move and updates the orientation
     * @type {MoveTransform}
     */
    static wideReplace(moves, index, orientation) {
        const rotKey = moves[index].toWide().getAssociatedRotation();
        ScrambleOptimizer.applyRotation(moves, index, orientation, rotKey);
    }

    /**
     * Changes the move at a given index to a prime move (assumes given move is double)
     * @type {MoveTransform}
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
     * @param {string} string 
     * @returns {Move[]}
     */
    static parseScramble(string) {
        return string.split(" ").map(Move.fromString);
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
        const rounded = Math.round(cost * 2) / 2;
        this.distribution.set(rounded, (this.distribution.get(rounded) || 0) + 1);
    }

    /**
     * @param {GripState} grip 
     * @param {MoveKey} moveKey 
     * @returns {Transition | null}
     */
    getTransitionFor(grip, moveKey) {
        return this.transitionCache?.[grip]?.[moveKey] || null;
    }

    /**
     * @param {Move[]} moves 
     * @param {number} index 
     * @param {GripState} currentGrip 
     * @param {number} currentCost 
     * @param {Orientation} orientation 
     * @param {Transition} lastTransition 
     * @param {GripState} [startGrip]
     * @param {number} [endIndex]
     * @param {SearchContext} [ctx]
     */
    bruteforceOptimize(moves, index, currentGrip, currentCost, orientation, lastTransition, startGrip = "F F", endIndex = moves.length, ctx) {
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
                    rotation: null,
                    startingGrip: startGrip,
                    finalOrientation: { ...orientation },
                    partitionBoundaries: [],
                    finalGrip: currentGrip,
                    lastTransition: lastTransition
                };
                ScrambleOptimizer.addCandidate(ctx.minResults, candidateItem, this.options.maxCapacity);
                ctx.minCost = ctx.minResults[0].cost;
            }
            this.recordCost(currentCost);
            return;
        }
        if (this.options.memoize) {
            const key = `${index}|${currentGrip}|${orientation.up}${orientation.front}|${moves.length}`;
            if ((this.memo[key] ?? Infinity) + this.options.depth <= currentCost) 
                return;
            this.memo[key] = currentCost;
        }

        /**
         * Create a new branch with a copied, mutated scramble
         * @param {MoveTransform | null} mutFn 
         * @param {number} skip Number of indices to jump
         */
        const branchWithClone = (mutFn, skip = 1) => {
            const clone = ScrambleOptimizer.copyScramble(moves);
            const newOrientation = { ...orientation };
            if(mutFn)
              mutFn(clone, index, newOrientation);

            /**
             * Evaluates direct move execution or candidate regrips at a specific scramble index.
             * @param {number} idx Index of the move in clone
             * @param {GripState} cGrip Current grip state
             * @param {number} cCost Cumulative cost up to this move
             * @param {Transition} lTrans Last transition executed
             */
            const evaluateMoveAt = (idx, cGrip, cCost, lTrans) => {
                const moved = clone[idx];
                const movedKey = moved.toKey();
                const directTrans = this.getTransitionFor(cGrip, movedKey);
                if (directTrans) {
                    const addedCost = this.computeTransitionCost(lTrans, directTrans, moved);
                    return [{
                        transition: directTrans,
                        nextGrip: directTrans.next,
                        cost: cCost + addedCost
                    }];
                }
                return this.findCandidateRegrips(cGrip, movedKey, moved, lTrans, cCost);
            };

            /**
             * Recursively evaluates candidate branches for multi-move sequence variations.
             * @param {number} subIdx Current index in clone
             * @param {GripState} cGrip Current grip state
             * @param {number} cCost Cumulative cost
             * @param {Transition} lTrans Last transition executed
             */
            const evaluateSequenceBranch = (subIdx, cGrip, cCost, lTrans) => {
                if (subIdx >= index + skip) {
                    this.bruteforceOptimize(clone, subIdx, cGrip, cCost, newOrientation, lTrans, startGrip, endIndex, ctx);
                    return;
                }
                const branches = evaluateMoveAt(subIdx, cGrip, cCost, lTrans);
                for (let i = 0; i < branches.length; i++) {
                    const b = branches[i];
                    clone[subIdx].transition = b.transition;
                    evaluateSequenceBranch(subIdx + 1, b.nextGrip, b.cost, b.transition);
                }
            };

            evaluateSequenceBranch(index, currentGrip, currentCost, lastTransition);
        };

        this.iterations++;
        const move = moves[index];

        // Normal branch
        branchWithClone(null, 1);

        const canWideReplace = this.canWideReplace(move);

        // wide variation (single-layer wide)
        if (canWideReplace)
            branchWithClone((arr, idx, or) => ScrambleOptimizer.wideReplace(arr, idx, or), 1);

        // prime variation for double (toggle R2 <-> R2')
        if(move.isDouble) { 
            branchWithClone((arr, idx, or) => ScrambleOptimizer.primeReplace(arr, idx, or), 1);

            // Combinations (prime + wide, prime + wideReplaceDouble, etc.)
            if (canWideReplace) {
                // prime + wide (prime then wideReplace)
                branchWithClone((arr, idx, or) => { 
                    ScrambleOptimizer.primeReplace(arr, idx, or); 
                    ScrambleOptimizer.wideReplace(arr, idx, or); 
                }, 1);
            }
        }
    }

    /**
     * Evaluates candidate regrips from currentGrip when direct execution is unavailable.
     * @param {GripState} currentGrip 
     * @param {MoveKey} movedKey 
     * @param {Move} moved 
     * @param {Transition} lTrans 
     * @param {number} cCost 
     */
    findCandidateRegrips(currentGrip, movedKey, moved, lTrans, cCost) {
        const maxBranches = this.options.maxRegripBranches ?? 2;
        const baseRegrip = this.config.general.regrip ?? 0;
        const regripPerStep = this.config.general.regripPerStep ?? 0;
        const distRow = Move.REGRIP_DIST_CACHE[currentGrip];

        let best1 = null;
        let best2 = null;

        for (let j = 0; j < this.allGripKeys.length; j++) {
            const targetGrip = this.allGripKeys[j];
            if (targetGrip === currentGrip) continue;

            const targetTrans = this.getTransitionFor(targetGrip, movedKey);
            if (!targetTrans) continue;

            const dist = distRow ? (distRow[targetGrip] ?? 0) : Move.computeRegripDistance(currentGrip, targetGrip);
            const rCost = baseRegrip + dist * regripPerStep;
            const regripTrans = {
                next: targetTrans.next,
                type: targetTrans.type,
                regripFrom: currentGrip,
                regripPrompt: targetGrip,
                regripCost: rCost
            };
            const addedCost = this.computeTransitionCost(lTrans, regripTrans, moved, null, currentGrip);
            const cand = {
                transition: regripTrans,
                nextGrip: targetTrans.next,
                cost: cCost + addedCost,
                addedCost: addedCost
            };

            if (!best1 || addedCost < best1.addedCost) {
                best2 = best1;
                best1 = cand;
            } else if (!best2 || addedCost < best2.addedCost) {
                best2 = cand;
            }
        }

        const candidates = [];
        if (best1) candidates.push(best1);
        if (best2 && maxBranches >= 2) candidates.push(best2);
        return candidates;
    }

    /**
     * Helper checking if wide replace can be applied to a move
     * @param {Move} move 
     * @returns {boolean}
     */
    canWideReplace(move) {
        return (this.options.wideReplace !== false) && move && (this.options.cubeSize !== 2 * (move.sliceNum || 1)) && !move.isWide && !move.isMiddle && !move.isRotation;
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
        let currCandidates = [{
            scramble: ScrambleOptimizer.copyScramble(scramble),
            cost: initialCost,
            rotation: null,
            startingGrip: startGrip,
            finalOrientation: { ...orientation },
            partitionBoundaries: [],
            finalGrip: startGrip,
            lastTransition: null
        }];

        let startIndex = 0;
        const scrambleLen = scramble.length;

        while (startIndex < scrambleLen) {
            /** @type {typeof currCandidates} */
            let nextCandidates = [];
            let nextStartIndex = startIndex;

            for (const cand of currCandidates) {
                const currentGrip = cand.finalGrip;
                const lastTrans = cand.lastTransition;
                const targetEndIndex = Math.min(startIndex + partitionLength, cand.scramble.length);
                const origLen = cand.scramble.length;

                /** @type {SearchContext} */
                const ctx = {
                    minCost: Infinity,
                    minResults: [],
                    minScramble: null,
                    minStartingGrip: startGrip,
                    minFinalGrip: currentGrip,
                    minFinalOrientation: null,
                    minLastTransition: null
                };

                this.bruteforceOptimize(cand.scramble, startIndex, currentGrip, cand.cost, cand.finalOrientation, lastTrans, startGrip, targetEndIndex, ctx);

                if (!ctx.minResults || ctx.minResults.length === 0) {
                    continue;
                }

                for (const res of ctx.minResults) {
                    const extraMoves = res.scramble.length - origLen;
                    const actualEndIndex = targetEndIndex + extraMoves;
                    const newBoundaries = [ ...(cand.partitionBoundaries || []) ];
                    if (actualEndIndex < res.scramble.length) {
                        newBoundaries.push(actualEndIndex);
                    }

                    /** @type {ScrambleCandidate} */
                    const candidateItem = {
                        scramble: res.scramble,
                        cost: res.cost,
                        rotation: null,
                        startingGrip: startGrip,
                        finalOrientation: res.finalOrientation,
                        partitionBoundaries: newBoundaries,
                        finalGrip: res.finalGrip,
                        lastTransition: res.lastTransition
                    };

                    const prevBestCost = nextCandidates[0]?.cost ?? Infinity;
                    ScrambleOptimizer.addCandidate(nextCandidates, candidateItem, this.options.maxCapacity);
                    if (nextCandidates[0].cost < prevBestCost) {
                        nextStartIndex = actualEndIndex;
                    }
                }
            }

            if (nextCandidates.length === 0) {
                return null;
            }

            currCandidates = nextCandidates;
            startIndex = nextStartIndex;
        }

        return currCandidates;
    }

    /**
     * Calls bruteforceOptimize for all orientations of the cube to find the best one
     * @param {RunOptions} options 
     */
    async optimize(options) {
        /** @type {RotationStr[]} */
        const top_rotations = [null, "x2", "x'", "x", "z", "z'"];
        /** @type {RotationStr[]} */
        const front_rotations = [null, "y", "y2", "y'"];

        /** @type {Orientation} */
        const orientation = {up: "U", front: "F"};
        const rawScramble = options.scramble || [];
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
            for (let k = faceMoves.length - 1; k >= 0; k--) {
                preprocessedScramble.unshift(faceMoves[k]);
            }
        }

        const cubeSize = options?.cubeSize || detectCubeSize(preprocessedScramble);
        if(!ScrambleOptimizer.supportedSizes.includes(cubeSize)) {
            throw new Error(`Unsupported cube size: ${cubeSize}x${cubeSize}`);
        }

        this.options = { ...defaultRunOptions, ...options, cubeSize };
        this.candidates = [];
        this.distribution = new Map();
        this.rotationInfo = [];
        this.memo = new Map();
        this.iterations = 0;

        const candidateGrips = this.allGripKeys;
        const partitionLength = Math.max(0, this.options.partitionLength || 0);

        for (const top_rot of top_rotations) {
            for(const front_rot of front_rotations) {
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
                    const initialCost = this.config.grip[startGrip] || 0;

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

                this.rotationInfo.push({
                    rotation: {up: top_rot || "", front: front_rot || ""}, 
                    startingGrip: bestGripStartingGrip,
                    cost: bestGripCost, 
                    iterations: orientationIterations,
                    maxed: this.iterations >= this.options.maxIterations,
                });

                if(this.callback)
                    await this.callback();

                if(!this.options.searchRotations)
                    return;
            }
        }
    }

    /**
     * @param {Transition} lastTransition 
     * @param {Transition} transition 
     * @param {Move} move
     * @param {CostDetails} [outDetails] Optional object to populate with itemized cost components
     * @param {GripState} [regripFromGrip] Optional starting grip if a regrip occurred before this move
     * @returns {number}
     */
    computeTransitionCost(lastTransition, transition, move, outDetails = null, regripFromGrip = null) {
        if (!transition) return Infinity;

        let added = 0;
        let regripCost = 0;
        if (transition.regripCost !== undefined) {
            regripCost = transition.regripCost;
        } else if (regripFromGrip) {
            const distance = Move.computeRegripDistance(regripFromGrip, transition.regripPrompt || transition.next);
            regripCost = (this.config.general.regrip ?? 0) + distance * (this.config.general.regripPerStep ?? 0);
        }
        added += regripCost;

        const gripCost = this.config.grip[transition.next] ?? 0;
        added += gripCost;

        const ftCost = this.config.fingertrick[transition.type] ?? 0;
        const totalFtCost = this.config.general.perSliceFingertrick ? move.getPhysicalSlices(this.options.cubeSize) * ftCost : ftCost;
        added += totalFtCost;

        const alphaCost = this.config.alpha[move.isWide ? move.alpha.toLowerCase() : move.alpha] ?? 0;
        added += alphaCost;

        //if(move.isDouble) added += this.config.general.double ?? 0;

        if (outDetails) {
            outDetails.regrip = regripCost;
            outDetails.grip = gripCost;
            outDetails.fingertrick = totalFtCost;
            outDetails.alpha = alphaCost;
        }

        return added;
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

        let lastTransition = null;

        for (let i = 0; i < candidate.scramble.length; i++) {
            const move = candidate.scramble[i];
            const transition = move.transition;
            if (!transition) {
                break;
            }

            const costBreakdown = {};
            const addedCost = this.computeTransitionCost(lastTransition, transition, move, costBreakdown, transition.regripFrom || null);
            lastTransition = transition;

            breakdown.push({
                move: move.toString(formatOptions.wedgeNotation, this.options.cubeSize), 
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

        const formatGrip = (g) => `[${g.replace(" ", "/")}]`;

        const { topColor, frontColor } = getOrientationColors(candidate.rotation);
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

        const solverStartOrientation = { up: "U", front: "F" };
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