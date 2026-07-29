import { Move } from "./move.js";
/** @import { CostConfig, TransitionConfig, Orientation, GripState, MoveKey, Transition, RunOptions, FormatOptions, OrientationResultInfo, ScrambleBreakdownEntry, CostDetails, RotationStr, Rotation } from "../types.js" */

/** @typedef {(moves: Move[], index: number, orientation: Orientation) => void} MoveTransform */

/**
 * @typedef {Object} SearchContext
 * @property {number} minCost
 * @property {Move[] | null} minScramble
 * @property {GripState} minStartingGrip
 * @property {GripState} minFinalGrip
 * @property {Orientation | null} minFinalOrientation
 * @property {Transition | null} minLastTransition
 */

export class ScrambleOptimizer {
    /** @type {CostConfig} */
    static defaultCostConfiguration = {
        "general": {
            "regrip": 6,
            "double": 0,
            "repeatPenalty": 1,
            "perSliceFingertrick": true
        },
        "alpha": { 
            "F": 0, "B": 1, "R": 0, "L": 1, "U": 0, "D": 1,
            "f": 3, "b": 3, "r": 1, "l": 2, "u": 3, "d": 3,
            "x": 2, "y": 2, "z": 2
        },
        "grip": {
            "F F": 0, "F U": 0, "F D": 0, "F Bd": 2, "F Bu": 2, 
            "U F": 0, "U U": 1, "U D": 0.5, "U Bd": 2, "U Bu": 2, 
            "D F": 0, "D U": 0.5, "D D": 1, "D Bd": 2, "D Bu": 2, 
            "Bd F": 2, "Bd U": 2, "Bd D": 2, "Bd Bd": 3, "Bd Bu": 3, 
            "Bu F": 2, "Bu U": 2, "Bu D": 2, "Bu Bd": 3, "Bu Bu": 3
        },
        "fingertrick": {
            "right_index": 0,
            "right_index_push": 2,
            "right_index_front": 3,
            "right_index_middle": 0,
            "right_ring": 1,
            "right_ring_middle": 1,
            "right_ring_push": 3,
            "right_up": 0,
            "right_up_double": 0,
            "right_down": 0,
            "right_down_double": 0,
            "left_index": 0,
            "left_index_push": 2,
            "left_index_front": 3,
            "left_index_middle": 0,
            "left_ring": 1,
            "left_ring_middle": 1,
            "left_ring_push": 3,
            "left_up": 0,
            "left_up_double": 0,
            "left_down": 0,
            "left_down_double": 0,
        }
    }

    /** @type {Move[]} */
    static ROTATION_CANDIDATES = ["x", "x'", "x2", "x2'"].map(Move.fromString);

    /** @type {FormatOptions} */
    static defaultFormatOptions = {
        showGrips: true,
        showBoundaries: false,
        wedgeNotation: false
    };

    /** @type {RunOptions} */
    static defaultRunOptions = {
        depth: 1,
        maxIterations: 999999,
        searchRotations: true,
        searchStartingGrips: true,
        pruneRotations: true,
        memoize: true,
        wideReplace: true,
        wideReplaceDouble: false,
        allowMidScrambleRotations: false,
        partitionLength: 0
    };

    /**
     * Detects the cube size (2, 3, 4, 5, 6, 7) from a parsed Move array.
     * @param {Move[]} moves 
     * @returns {number} Cube size N
     */
    static detectCubeSize(moves) {
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
     * 
     * @param {CostConfig} config 
     * @param {TransitionConfig} transitions
     * @param {()} callback
     */
    constructor(config, transitions, callback) {
        /** @type {CostConfig} */
        this.config = config;
        /** @type {TransitionConfig} */
        this.transitions = transitions;
        /** @type {()} Function to call when a rotation optimization finishes */
        this.callback = callback;
        /** @type {number} The detected or assigned cube size (e.g. 2, 3, 4, 5, 6, 7) */
        this.cubeSize = 3;
        /** @type {number} The current number of iterations from bruteforceOptimize */
        this.iterations = 0;
        /** @type {Map<number, number>} Amount of found scrambles with a specific cost */
        this.distribution = null;
        /** @type {number} The branch pruning threshold */
        this.depth = 0;
        /** @type {number} Number of iterations to try before bailing out */
        this.maxIterations = Infinity;
        /** @type {Rotation} Current best orientation */
        this.bestRotation = null;
        /** @type {GripState} Current best starting grip */
        this.bestStartingGrip = "start";
        /** @type {number} The lowest cost found for all orientations */
        this.bestCost = Infinity;
        /** @type {boolean} If an orientation search should be stopped if worse than best orientation */
        this.pruneRotations = true;
        /** @type {Move[]} The best scramble found for all orientations */
        this.bestScramble = null;
        /** @type {boolean} If search shouldn't continue if same index, orientation and grip is reached */
        this.memoize = true;
        /** @type {boolean} If search should try replacing double moves with 1 wide and 1 normal move */
        this.doWideReplaceDouble = true;
        /** @type {OrientationResultInfo[]} */
        this.rotationInfo = null;
        /** @type {Map<string, number>} Memoization for all orientations */
        this.memo = new Map();
    }

    /**
     * Applies rotation to all moves after `index` and updates orientation.
     * @param {Move[]} moves 
     * @param {number} index 
     * @param {Orientation} orientation 
     * @param {RotationStr} rotation 
     */
    static applyRotation(moves, index, orientation, rotation) {
        for (let i = index + 1; i < moves.length; i++) {
            moves[i].transpose(rotation);
        }
        orientation.up = Move.TRANSPOSITIONS[rotation][orientation.up];
        orientation.front = Move.TRANSPOSITIONS[rotation][orientation.front];
    }

    /**
     * Changes the move at a given index to a wide move and updates the orientation
     * @type {MoveTransform}
     */
    static wideReplace(moves, index, orientation) {
        moves[index].alpha = Move.WIDE_EQUIVALENTS[moves[index].alpha];
        moves[index].isWide = true;
        ScrambleOptimizer.applyRotation(moves, index, orientation, Move.WIDE_ROTATIONS[moves[index].toKey()]);
    }

    /**
     * Changes a move at a given index to be composed of a wide move and a normal move (assumes given move is double)
     * @type {MoveTransform}
     */
    static wideReplaceDouble(moves, index, orientation) {
        const newMove = new Move(Move.WIDE_EQUIVALENTS[moves[index].alpha], moves[index].isPrime, false, false, true);
        moves[index].isDouble = false;
        moves.splice(index, 0, newMove);
        ScrambleOptimizer.applyRotation(moves, index, orientation, Move.WIDE_ROTATIONS[newMove.toKey()]);
    }

    /**
     * Changes the move at a given index to a prime move (assumes given move is double)
     * @type {MoveTransform}
     */
    static primeReplace(moves, index, orientation) {
        moves[index].isPrime = true;
    }

    /**
     * Inserts a mid-scramble rotation before the move at `index` and transposes subsequent moves
     * @param {Move[]} moves 
     * @param {number} index 
     * @param {Orientation} orientation 
     * @param {Move} rotMove 
     */
    static insertRotation(moves, index, orientation, rotMove) {
        moves.splice(index, 0, new Move(rotMove.alpha, rotMove.isPrime, rotMove.isDouble, rotMove.isRotation, rotMove.isWide, rotMove.sliceNum));
        ScrambleOptimizer.applyRotation(moves, index, orientation, rotMove.toKey());
    }

    /**
     * @param {Move[]} moves 
     * @returns {Move[]}
     */
    static copyScramble(moves) {
        return moves.map(move=>new Move(move.alpha, move.isPrime, move.isDouble, move.isRotation, move.isWide, move.sliceNum));
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
     */
    getTransitionFor(grip, moveKey) { //TODO needed?
        return this.transitions[grip]?.[moveKey];
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
    bruteforceOptimize(moves, index, currentGrip, currentCost, orientation, lastTransition, startGrip = "start", endIndex = moves.length, ctx) {
        if (this.iterations >= this.maxIterations) {
            return;
        }
        if(this.pruneRotations && currentCost > this.bestCost+this.depth) {
            return;
        }
        if(ctx && currentCost > ctx.minCost+this.depth) {
            return;
        }
        if (index >= endIndex) {
            if (ctx && currentCost < ctx.minCost) {
                ctx.minCost = currentCost;
                ctx.minScramble = ScrambleOptimizer.copyScramble(moves);
                ctx.minStartingGrip = startGrip;
                ctx.minFinalGrip = currentGrip;
                ctx.minFinalOrientation = { ...orientation };
                ctx.minLastTransition = lastTransition;
            }
            this.recordCost(currentCost);
            return;
        }
        if(this.memoize) {
            const key = `${index}|${currentGrip}|${orientation.up}${orientation.front}|${moves.length}`;
            if ((this.memo[key] ?? Infinity) + this.depth <= currentCost) 
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

            let cost = currentCost;
            let grip = currentGrip;
            let transition;
            for(let i = 0; i < skip; i++) {
                const moved = clone[index+i];
                const movedKey = moved.toKey();
                transition = this.getTransitionFor(grip, movedKey);
                if (!transition) {
                    //console.error("invalid branch", currentGrip, movedKey);
                    return;
                }
                cost += this.computeTransitionCost(lastTransition, transition, moved);
                grip = transition.next;
            }

            const newEndIndex = endIndex + (clone.length - moves.length);
            this.bruteforceOptimize(clone, index + skip, grip, cost, newOrientation, transition, startGrip, newEndIndex, ctx);
        }

        const move = moves[index];
        this.iterations++;

        branchWithClone(null, 1);

        if(move.isRotation)
            return;

        // Mid-scramble rotation insertion (e.g. x, x', x2)
        if (this.allowMidScrambleRotations) {
            for (const rot of ScrambleOptimizer.ROTATION_CANDIDATES) {
                branchWithClone((arr, idx, or) => ScrambleOptimizer.insertRotation(arr, idx, or, rot), 2);
            }
        }

        // wide variation (single-layer wide)
        if (this.doWideReplace && !move.isWide)
            branchWithClone((arr, idx, or) => ScrambleOptimizer.wideReplace(arr, idx, or), 1);

        // prime variation for double (turn R2 into R2' variant)
        if(move.isDouble) { 
            if (!move.isPrime)
                branchWithClone((arr, idx, or) => ScrambleOptimizer.primeReplace(arr, idx, or), 1);

            // Combinations (prime + wide, prime + wideReplaceDouble, etc.)
            if (this.doWideReplace && !move.isWide) {
                // prime + wide (prime then wideReplace)
                branchWithClone((arr, idx, or) => { ScrambleOptimizer.primeReplace(arr, idx, or); ScrambleOptimizer.wideReplace(arr, idx, or); }, 1);
            }

            if (!move.isWide && this.doWideReplaceDouble) {
                // wideReplaceDouble (change double move into 1 face move and 1 wide move)
                // inserts an extra move at index (length increases) so skip=2
                branchWithClone((arr, idx, or) =>  ScrambleOptimizer.wideReplaceDouble(arr, idx, or), 2);
                if(!move.isPrime)
                    branchWithClone((arr, idx, or) => { ScrambleOptimizer.primeReplace(arr, idx, or); ScrambleOptimizer.wideReplaceDouble(arr, idx, or); }, 2);
            }
        }
    }

    /**
     * Runs sequential partition search for a given initial scramble, starting grip, and orientation
     * @param {Move[]} scramble 
     * @param {GripState} startGrip 
     * @param {number} initialCost 
     * @param {Orientation} orientation 
     * @param {number} partitionLength 
     * @returns {{ cost: number, scramble: Move[], boundaries: number[] } | null}
     */
    runPartitionSequence(scramble, startGrip, initialCost, orientation, partitionLength) {
        let currScramble = ScrambleOptimizer.copyScramble(scramble);
        let currOrientation = { ...orientation };
        let currGrip = startGrip;
        let currCost = initialCost;
        let currLastTransition = null;
        let startIndex = 0;
        const boundaries = [];

        while (startIndex < currScramble.length) {
            const targetEndIndex = Math.min(startIndex + partitionLength, currScramble.length);
            const origLen = currScramble.length;

            /** @type {SearchContext} */
            const ctx = {
                minCost: Infinity,
                minScramble: null,
                minStartingGrip: startGrip,
                minFinalGrip: currGrip,
                minFinalOrientation: null,
                minLastTransition: null
            };

            this.bruteforceOptimize(currScramble, startIndex, currGrip, currCost, currOrientation, currLastTransition, startGrip, targetEndIndex, ctx);

            if (!ctx.minScramble) {
                return null;
            }

            currScramble = ctx.minScramble;
            currCost = ctx.minCost;
            currGrip = ctx.minFinalGrip;
            currOrientation = ctx.minFinalOrientation;
            currLastTransition = ctx.minLastTransition;

            const extraMoves = currScramble.length - origLen;
            const actualEndIndex = targetEndIndex + extraMoves;
            if (actualEndIndex < currScramble.length) {
                boundaries.push(actualEndIndex);
            }
            startIndex = actualEndIndex;
        }

        return { cost: currCost, scramble: currScramble, boundaries };
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

        this.depth = options.depth;
        this.maxIterations = options.maxIterations;
        this.pruneRotations = options.pruneRotations;
        this.bestScramble = options.scramble;
        this.memoize = options.memoize;
        this.doWideReplace = options.wideReplace !== false;
        this.doWideReplaceDouble = options.wideReplaceDouble;
        this.allowMidScrambleRotations = options.allowMidScrambleRotations || false;
        this.cubeSize = options.cubeSize || ScrambleOptimizer.detectCubeSize(options.scramble);
        const partitionLength = Math.max(0, options.partitionLength || 0);

        this.bestRotation = {up: null, front: null};
        this.bestStartingGrip = "start";
        this.bestCost = Infinity;
        this.bestPartitionBoundaries = [];
        this.distribution = new Map();
        this.rotationInfo = [];
        this.memo = new Map();

        /** @type {Orientation} */
        const orientation = {up: "U", front: "F"};

        const candidateGrips = (options.searchStartingGrips !== false)
            ? Object.keys(this.transitions).filter(g => g !== "start")
            : ["start"];

        for (const top_rot of top_rotations) {
            for(const front_rot of front_rotations) {
                const rotatedScramble = ScrambleOptimizer.copyScramble(options.scramble);
                const newOrientation = { ...orientation };

                // transpose all moves according to the starting rotation
                if (top_rot !== null) {
                    rotatedScramble.forEach(move => move.transpose(top_rot));
                    newOrientation.up = Move.TRANSPOSITIONS[top_rot][newOrientation.up];
                }
                if (front_rot !== null) {
                    rotatedScramble.forEach(move => move.transpose(front_rot));
                    newOrientation.front = Move.TRANSPOSITIONS[front_rot][newOrientation.front];
                }

                this.iterations = 0;

                let bestGripCost = Infinity;
                let bestGripScramble = null;
                let bestGripStartingGrip = candidateGrips[0] || "F F";
                let bestGripBoundaries = [];

                for (const startGrip of candidateGrips) {
                    const initialCost = (startGrip === "start") ? 0 : (this.config.grip[startGrip] || 0);

                    const effectivePartition = (partitionLength > 0) ? partitionLength : rotatedScramble.length;
                    const result = this.runPartitionSequence(rotatedScramble, startGrip, initialCost, newOrientation, effectivePartition);
                    if (result && result.cost < bestGripCost) {
                        bestGripCost = result.cost;
                        bestGripScramble = result.scramble;
                        bestGripStartingGrip = startGrip;
                        bestGripBoundaries = result.boundaries;
                    }
                }

                this.rotationInfo.push({ // TODO know the max index that was reached?
                    rotation: {up: top_rot || "", front: front_rot || ""}, 
                    startingGrip: bestGripStartingGrip,
                    cost: bestGripCost, 
                    iterations: this.iterations,
                    maxed: this.iterations > this.maxIterations,
                });

                if (bestGripCost < this.bestCost) {
                    this.bestCost = bestGripCost;
                    this.bestScramble = ScrambleOptimizer.copyScramble(bestGripScramble);
                    this.bestRotation = {up: top_rot, front: front_rot};
                    this.bestStartingGrip = bestGripStartingGrip;
                    this.bestPartitionBoundaries = bestGripBoundaries || [];
                }

                if(this.callback)
                    await this.callback();

                if(!options.searchRotations)
                    return;
            }
        }
    }

    /**
     * @param {Transition} lastTransition 
     * @param {Transition} transition 
     * @param {Move} move
     * @param {CostDetails} [outDetails] Optional object to populate with itemized cost components
     * @returns {number}
     */
    computeTransitionCost(lastTransition, transition, move, outDetails = null) {
        if (!transition) return 999999;

        let added = 0;
        const regripCost = (transition.regrip && this.config.general.regrip) ? this.config.general.regrip : 0;
        added += regripCost;

        const gripCost = this.config.grip[transition.next] ?? 0;
        added += gripCost;

        const ftCost = this.config.fingertrick[transition.type] ?? 0;
        const totalFtCost = this.config.general.perSliceFingertrick ? move.getPhysicalSlices(this.cubeSize) * ftCost : ftCost;
        added += totalFtCost;

        const alphaCost = this.config.alpha[move.isWide ? move.alpha.toLowerCase() : move.alpha] ?? 0;
        added += alphaCost;

        const doubleCost = (move.isDouble && this.config.general.double) ? this.config.general.double : 0;
        added += doubleCost;

        const repeatCost = (lastTransition?.type === transition.type && this.config.general.repeatPenalty) ? this.config.general.repeatPenalty : 0;
        added += repeatCost;

        if (outDetails) {
            outDetails.regrip = regripCost;
            outDetails.grip = gripCost;
            outDetails.fingertrick = totalFtCost;
            outDetails.alpha = alphaCost;
            outDetails.double = doubleCost;
            outDetails.repeatPenalty = repeatCost;
        }

        return added;
    }

    /**
     * @param {Move[]} scramble 
     * @param {GripState} [startGrip]
     * @param {FormatOptions} [formatOptions]
     */
    analyze(scramble, startGrip = this.bestStartingGrip, options = ScrambleOptimizer.defaultFormatOptions) {
        const boundaries = this.bestPartitionBoundaries || [];
        let totalCost = 0;

        /** @type {GripState} */
        let currentGrip = startGrip || "F F";

        /** @type {ScrambleBreakdownEntry[]} */
        const breakdown = [];

        let lastTransition;
        for (let i = 0; i < scramble.length; i++) {
            const move = scramble[i];
            const moveKey = move.toKey();

            const transition = this.getTransitionFor(currentGrip, moveKey);
            if (!transition) {
                break;
            }

            const nextGrip = transition.next;
            const costBreakdown = {};
            const addedCost = this.computeTransitionCost(lastTransition, transition, move, costBreakdown);
            lastTransition = transition;

            breakdown.push({
                move: move.toString(options.wedgeNotation, this.cubeSize), 
                transition, 
                addedCost,
                costBreakdown,
                isPartitionBoundary: i > 0 && boundaries.includes(i)
            });

            totalCost += addedCost;
            currentGrip = nextGrip;
        }

        return breakdown;
    }

    /**
     * @param {FormatOptions} [formatOptions]
     */
    analyzeBest(formatOptions = ScrambleOptimizer.defaultFormatOptions) {
        return this.analyze(this.bestScramble, this.bestStartingGrip, formatOptions);
    }

    /**
     * @param {FormatOptions} [formatOptions]
     */
    getBestAsString(options = ScrambleOptimizer.defaultFormatOptions) {
        if (!this.bestScramble) return "";

        const formatGrip = (g) => `[${g.replace(" ", "/")}]`;

        const rotations = [this.bestRotation?.up, this.bestRotation?.front].filter(Boolean);
        const startGrip = options.showGrips && this.bestStartingGrip ? [formatGrip(this.bestStartingGrip)] : [];
        const breakdown = this.analyzeBest(options);

        const moves = [];
        for (let i = 0; i < this.bestScramble.length; i++) {
            if (options.showBoundaries && breakdown[i]?.isPartitionBoundary) {
                moves.push("|");
            }
            const move = this.bestScramble[i];
            const transition = breakdown[i]?.transition;
            const moveStr = move.toString(options.wedgeNotation, this.cubeSize);
            if (options.showGrips && transition?.regrip && transition?.next) {
                moves.push(formatGrip(transition.next));
            }
            moves.push(moveStr);
        }

        return [...rotations, ...startGrip, ...moves].join(" ");
    }
}
