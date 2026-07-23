import { Move } from "./move.js";
/** @import { CostConfig, TransitionConfig, Orientation, GripState, MoveKey, Transition, RunOptions, OrientationResultInfo, ScrambleBreakdownEntry, RotationStr, Rotation } from "../types.js" */

/** @typedef {(moves: Move[], index: number, orientation: Orientation) => void} MoveTransform */

export class ScrambleOptimizer {
    /** @type {CostConfig} */
    static defaultCostConfiguration = {
        "general": {
            "regrip": 6,
            "double": 0,
            "repeatPenalty": 1,
            "wideMultiplier": 2
        },
        "alpha": { 
            "F": 0, "B": 1, "R": 0, "L": 1, "U": 0, "D": 1,
            "f": 3, "b": 3, "r": 1, "l": 2, "u": 3, "d": 3
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
            "left_index_middle": 0,
            "left_ring": 1,
            "left_ring_middle": 1,
            "left_ring_push": 3,
            "left_up": 0,
            "left_up_double": 0,
            "left_down": 0,
            "left_down_double": 0
        }
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
        /** @type {Move[]} The current minimum cost scramble */
        this.minScramble = null;
        /** @type {number} The current minimum cost */
        this.minCost = Infinity;
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
     * Changes the move at a given index to a wide move and updates the orientation
     * @type {MoveTransform}
     */
    static wideReplace(moves, index, orientation) {
        moves[index].alpha = Move.WIDE_EQUIVALENTS[moves[index].alpha]
        moves[index].isWide = true;
        ScrambleOptimizer._applyWideRotation(moves, index, orientation);
    }

    /**
     * Changes a move at a given index to be composed of a wide move and a normal move (assumes given move is double)
     * @type {MoveTransform}
     */
    static wideReplaceDouble(moves, index, orientation) {
        const newMove = new Move(Move.WIDE_EQUIVALENTS[moves[index].alpha], moves[index].isPrime, false, false, true);
        moves[index].isDouble = false;
        moves.splice(index, 0, newMove);
        ScrambleOptimizer._applyWideRotation(moves, index, orientation);
    }

    /**
     * Applies the rotation caused by a wide move at `index` to all subsequent moves and the cube orientation.
     * @type {MoveTransform}
     */
    static _applyWideRotation(moves, index, orientation) {
        const rotation = Move.WIDE_ROTATIONS[moves[index].toKey()];

        for (let i = index + 1; i < moves.length; i++) {
            moves[i].transpose(rotation);
        }

        orientation.up = Move.TRANSPOSITIONS[rotation][orientation.up];
        orientation.front = Move.TRANSPOSITIONS[rotation][orientation.front];
    }

    /**
     * Changes the move at a given index to a prime move (assumes given move is double)
     * @type {MoveTransform}
     */
    static primeReplace(moves, index, orientation) {
        moves[index].isPrime = true;
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
     * @param {Transition} lastTransition 
     * @param {Transition} transition 
     * @param {Move} move
     * @returns 
     */
    computeTransitionCost(lastTransition, transition, move) { //TODO should probably have a better prevention of NaNs
        let added = 0;
        if (!transition) return 999999;
        if (transition.regrip) added += this.config.general.regrip;
        added += this.config.grip[transition.next];
        added += (move.isWide || move.sliceNum > 1)? this.config.fingertrick[transition.type] * this.config.general.wideMultiplier : this.config.fingertrick[transition.type];
        added += this.config.alpha[move.isWide ? move.alpha.toLowerCase() : move.alpha];
        if(move.isDouble) added += this.config.general.double;
        if(lastTransition?.type == transition.type) added += this.config.general.repeatPenalty;
        return added;
    }

    /**
     * @param {Move[]} moves 
     * @param {number} index 
     * @param {GripState} currentGrip 
     * @param {number} currentCost 
     * @param {Orientation} orientation 
     * @param {Transition} lastTransition 
     */
    bruteforceOptimize(moves, index, currentGrip, currentCost, orientation, lastTransition) {
        if (this.iterations >= this.maxIterations) {
            return;
        }
        if(this.pruneRotations && currentCost > this.bestCost+this.depth) {
            return;
        }
        if(currentCost > this.minCost+this.depth) {
            return;
        }
        if (index >= moves.length) {
            if (currentCost < this.minCost) {
                this.minCost = currentCost;
                this.minScramble = ScrambleOptimizer.copyScramble(moves);
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

            this.bruteforceOptimize(clone, index + skip, grip, cost, newOrientation, transition);
        }

        const move = moves[index];
        this.iterations++;

        branchWithClone(null, 1);

        if(move.isRotation)
            return;

        // wide variation (single-layer wide)
        if (!move.isWide)
            branchWithClone((arr, idx, or) => ScrambleOptimizer.wideReplace(arr, idx, or), 1);

        // prime variation for double (turn R2 into R2' variant)
        if(move.isDouble) { 
            if (!move.isPrime)
                branchWithClone((arr, idx, or) => ScrambleOptimizer.primeReplace(arr, idx, or), 1);

            // Combinations (prime + wide, prime + wideReplaceDouble, etc.)
            if (!move.isWide) {
                // prime + wide (prime then wideReplace)
                branchWithClone((arr, idx, or) => { ScrambleOptimizer.primeReplace(arr, idx, or); ScrambleOptimizer.wideReplace(arr, idx, or); }, 1);

                if(this.doWideReplaceDouble) {
                    // wideReplaceDouble (change double move into 1 face move and 1 wide move)
                    // inserts an extra move at index (length increases) so skip=2
                    branchWithClone((arr, idx, or) =>  ScrambleOptimizer.wideReplaceDouble(arr, idx, or), 2);
                    if(!move.isPrime)
                        branchWithClone((arr, idx, or) => { ScrambleOptimizer.primeReplace(arr, idx, or); ScrambleOptimizer.wideReplaceDouble(arr, idx, or); }, 2);
                }
            }
        }
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
        this.doWideReplaceDouble = options.wideReplaceDouble;

        this.bestRotation = {up: null, front: null};
        this.bestCost = Infinity;
        this.distribution = new Map();
        this.rotationInfo = [];
        this.memo = new Map();

        /** @type {Orientation} */
        const orientation = {up: "U", front: "F"};

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

                this.minCost = Infinity; //TODO move to context object that we pass to bruteforceOptimize?
                this.minScramble = null;
                this.iterations = 0;
            
                this.bruteforceOptimize(rotatedScramble, 0, "start", 0, newOrientation);

                this.rotationInfo.push({ // TODO know the max index that was reached?
                    rotation: {up: top_rot || "", front: front_rot || ""}, 
                    cost: this.minCost, 
                    iterations: this.iterations,
                    maxed: this.iterations > this.maxIterations,
                });

                
                if (this.minCost < this.bestCost) {
                    this.bestCost = this.minCost;
                    this.bestScramble = ScrambleOptimizer.copyScramble(this.minScramble);
                    this.bestRotation = {up: top_rot, front: front_rot};
                }

                if(this.callback)
                    await this.callback();

                if(!options.searchRotations)
                    return;
            }
        }
    }
    
    /**
     * @param {Move[]} scramble 
     */
    analyze(scramble) {
        let totalCost = 0;

        /** @type {GripState} */
        let currentGrip = "start";

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
            const addedCost = this.computeTransitionCost(lastTransition, transition, move);
            lastTransition = transition;

            breakdown.push({move: move.toString(), transition, addedCost });

            totalCost += addedCost;
            currentGrip = nextGrip;
        }

        return breakdown;
    }

    analyzeBest() {
        return this.analyze(this.bestScramble);
    }

    getBestAsString() {
        if(!this.bestScramble)
            return "";
        const scramble = ScrambleOptimizer.copyScramble(this.bestScramble);
        if(this.bestRotation.front)
            scramble.unshift(Move.fromString(this.bestRotation.front));
        if(this.bestRotation.up)
            scramble.unshift(Move.fromString(this.bestRotation.up));

        return ScrambleOptimizer.getScrambleString(scramble);
    }
}
