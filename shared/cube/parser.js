import { Move } from "./move.js";
import { defaultParseOptions } from "../defaults.js";

/** @typedef {'wca' | 'sign' | null} NotationMode */

/**
 * @typedef {Object} ParseOptions
 * @property {NotationMode} notation Notation mode convention to use (null for auto-detect)
 * @property {number} maxNestingDepth Maximum allowed nesting depth for commutators/conjugates/groups
 */

/**
 * @typedef {Object} ParseResult
 * @property {Move[]} moves Fully expanded, flat Move array
 * @property {NotationMode} resolvedNotation The resolved notation mode that was used ('wca' | 'sign')
 */

const MOVE_REGEX = /^(\d*)([RLUDFBrludfbMESxyz])(w)?(2)?(')?$/;

/**
 * Token types for scramble parsing
 * @typedef {'MOVE' | 'LBRACKET' | 'RBRACKET' | 'LPAREN' | 'RPAREN' | 'COMMA' | 'COLON' | 'NUMBER' | 'PRIME' | 'EOF'} TokenType
 */

/**
 * @typedef {Object} Token
 * @property {TokenType} type
 * @property {string} value
 * @property {number} index
 */

export class ScrambleParser {
    /**
     * Parses a raw scramble string (supporting commutators, conjugates, groups, and SiGN/WCA notation).
     * @param {string} input - Raw scramble input string
     * @param {Partial<ParseOptions>} [options] - Parsing configuration options
     * @returns {ParseResult}
     */
    static parse(input, options = {}) {
        if (typeof input !== "string") {
            throw new SyntaxError("Scramble input must be a string");
        }

        const opts = { ...defaultParseOptions, ...options };
        const maxDepth = opts.maxNestingDepth;
        const rawTokens = ScrambleParser.tokenize(input);

        // Resolve notation mode
        const resolvedNotation = opts.notation ?? ScrambleParser.detectNotation(rawTokens);

        // Parse token stream into AST / Move array
        const parser = new ScrambleParser(rawTokens, resolvedNotation, maxDepth);
        const moves = parser.parseScramble();

        return {
            moves,
            resolvedNotation
        };
    }

    /**
     * Tokenizes raw input string into token array.
     * @param {string} input 
     * @returns {Token[]}
     */
    static tokenize(input) {
        /** @type {Token[]} */
        const tokens = [];
        let i = 0;
        const len = input.length;

        while (i < len) {
            const char = input[i];

            // Skip whitespace
            if (/\s/.test(char)) {
                i++;
                continue;
            }

            // Single-character structural tokens
            if (char === "[") {
                tokens.push({ type: "LBRACKET", value: "[", index: i });
                i++;
                continue;
            }
            if (char === "]") {
                tokens.push({ type: "RBRACKET", value: "]", index: i });
                i++;
                continue;
            }
            if (char === "(") {
                tokens.push({ type: "LPAREN", value: "(", index: i });
                i++;
                continue;
            }
            if (char === ")") {
                tokens.push({ type: "RPAREN", value: ")", index: i });
                i++;
                continue;
            }
            if (char === ",") {
                tokens.push({ type: "COMMA", value: ",", index: i });
                i++;
                continue;
            }
            if (char === ":") {
                tokens.push({ type: "COLON", value: ":", index: i });
                i++;
                continue;
            }

            // Post-group modifiers: digits or prime following ], ), or NUMBER after group
            const prevToken = tokens[tokens.length - 1];
            const isAfterGroup = prevToken && (
                prevToken.type === "RBRACKET" ||
                prevToken.type === "RPAREN" ||
                (prevToken.type === "NUMBER" && tokens.length >= 2 && (tokens[tokens.length - 2].type === "RBRACKET" || tokens[tokens.length - 2].type === "RPAREN"))
            );
            if (isAfterGroup) {
                if (/\d/.test(char) && prevToken.type !== "NUMBER") {
                    let numStr = "";
                    const numStart = i;
                    while (i < len && /\d/.test(input[i])) {
                        numStr += input[i];
                        i++;
                    }
                    tokens.push({ type: "NUMBER", value: numStr, index: numStart });
                    continue;
                }
                if (char === "'") {
                    tokens.push({ type: "PRIME", value: "'", index: i });
                    i++;
                    continue;
                }
            }

            // Move token: digit(s)? + letter + w? + 2? + '?
            let matchStr = "";
            const moveStart = i;

            // Consume optional digits
            while (i < len && /\d/.test(input[i])) {
                matchStr += input[i];
                i++;
            }
            // Consume letter
            if (i < len && /[RLUDFBrludfbMESxyz]/.test(input[i])) {
                matchStr += input[i];
                i++;
                // Consume optional 'w'
                if (i < len && input[i] === "w") {
                    matchStr += "w";
                    i++;
                }
                // Consume optional '2'
                if (i < len && input[i] === "2") {
                    matchStr += "2";
                    i++;
                }
                // Consume optional "'"
                if (i < len && input[i] === "'") {
                    matchStr += "'";
                    i++;
                }

                if (MOVE_REGEX.test(matchStr)) {
                    tokens.push({ type: "MOVE", value: matchStr, index: moveStart });
                    continue;
                }
            }

            throw new SyntaxError(`Unexpected character '${char}' at index ${i}`);
        }

        tokens.push({ type: "EOF", value: "", index: len });
        return tokens;
    }

    /**
     * Auto-detects notation convention (WCA vs SiGN) from tokens.
     * @param {Token[]} tokens 
     * @returns {NotationMode}
     */
    static detectNotation(tokens) {
        let hasW = false;
        let lowercaseCount = 0;
        let moveCount = 0;

        for (const token of tokens) {
            if (token.type === "MOVE") {
                moveCount++;
                if (token.value.includes("w")) {
                    hasW = true;
                }
                const match = MOVE_REGEX.exec(token.value);
                if (match) {
                    const letter = match[2];
                    if (/[rludfb]/.test(letter)) {
                        lowercaseCount++;
                    }
                }
            }
        }

        if (hasW) return "wca";
        if (lowercaseCount > 0) {
            if (moveCount > 30) return "sign"; // 4x4+
            return "wca"; // 3x3 with wide moves
        }

        return "wca";
    }

    /**
     * Constructs a ScrambleParser instance.
     * @param {Token[]} tokens 
     * @param {NotationMode} notation 
     * @param {number} maxDepth 
     */
    constructor(tokens, notation, maxDepth) {
        this.tokens = tokens;
        this.notation = notation;
        this.maxDepth = maxDepth;
        this.pos = 0;
        this.currentDepth = 0;
    }

    peek() {
        return this.tokens[this.pos];
    }

    /**
     * Consumes current token and advances position.
     * @param {TokenType} [expectedType] 
     * @returns {Token}
     */
    consume(expectedType) {
        const token = this.peek();
        if (expectedType && token.type !== expectedType) {
            throw new SyntaxError(
                `Expected token '${expectedType}' but got '${token.type}' (${token.value || "EOF"}) at index ${token.index}`
            );
        }
        this.pos++;
        return token;
    }

    parseScramble() {
        const moves = this.parseSequence();
        if (this.peek().type !== "EOF") {
            const t = this.peek();
            throw new SyntaxError(`Unexpected token '${t.value}' at index ${t.index}`);
        }
        return moves;
    }

    parseSequence() {
        /** @type {Move[]} */
        const moves = [];

        while (true) {
            const token = this.peek();
            if (
                token.type === "EOF" ||
                token.type === "RBRACKET" ||
                token.type === "RPAREN" ||
                token.type === "COMMA" ||
                token.type === "COLON"
            ) {
                break;
            }

            if (token.type === "MOVE") {
                moves.push(this.parseMove());
            } else if (token.type === "LBRACKET") {
                moves.push(...this.parseCommutator());
            } else if (token.type === "LPAREN") {
                moves.push(...this.parseGroup());
            } else {
                throw new SyntaxError(`Unexpected token '${token.value}' at index ${token.index}`);
            }
        }

        return moves;
    }

    parseMove() {
        const token = this.consume("MOVE");
        return this.createMoveFromToken(token.value, token.index);
    }

    /**
     * Converts single move string token to Move object based on notation mode.
     * @param {string} str 
     * @param {number} index 
     * @returns {Move}
     */
    createMoveFromToken(str, index) {
        const match = MOVE_REGEX.exec(str);
        if (!match) {
            throw new SyntaxError(`Invalid move string '${str}' at index ${index}`);
        }

        const [, slicePrefix, letter, wModifier, doubleTurn, primeTurn] = match;

        let alpha = letter;
        let isPrime = Boolean(primeTurn);
        let isDouble = Boolean(doubleTurn);
        let isRotation = false;
        let isInvertedSlice = false;
        let isMiddle = false;
        let sliceNum = slicePrefix ? parseInt(slicePrefix, 10) : 0;

        const isLowercase = /[rludfb]/.test(letter);
        const upperFace = letter.toUpperCase();

        if (Move.MOVE_LIST.includes(/** @type {any} */ (upperFace))) {
            alpha = upperFace;

            if (isLowercase) {
                if (this.notation === "sign") {
                    // SiGN mode: lowercase face move means 2 slices (Rw) or slicePrefix slices (3r -> 3Rw)
                    sliceNum = sliceNum || 2;
                    isInvertedSlice = false;
                } else {
                    // WCA mode: lowercase face move sets isInvertedSlice = true (size-relative)
                    isInvertedSlice = true;
                    if (wModifier) {
                        sliceNum = sliceNum || 2;
                    } else {
                        sliceNum = sliceNum || 1;
                    }
                }
            } else {
                if (wModifier) {
                    sliceNum = sliceNum || 2;
                } else {
                    sliceNum = slicePrefix ? sliceNum : 1;
                }
            }
        } else if (Move.MIDDLE_MOVE_LIST.includes(/** @type {any} */ (letter))) {
            alpha = letter;
            isMiddle = true;
            sliceNum = 1;
        } else if (Move.ROTATION_LIST.includes(/** @type {any} */ (letter))) {
            alpha = letter;
            isRotation = true;
            sliceNum = 0;
        } else {
            throw new SyntaxError(`Unknown move character '${letter}' at index ${index}`);
        }

        return new Move(
            /** @type {any} */ (alpha),
            isPrime,
            isDouble,
            isRotation,
            isInvertedSlice,
            isMiddle,
            sliceNum
        );
    }

    parseCommutator() {
        this.checkDepth();
        this.currentDepth++;

        this.consume("LBRACKET");
        const aSequence = this.parseSequence();

        const sepToken = this.peek();
        if (sepToken.type !== "COMMA" && sepToken.type !== "COLON") {
            throw new SyntaxError(
                `Expected ',' or ':' inside commutator/conjugate at index ${sepToken.index}`
            );
        }
        this.consume();

        const bSequence = this.parseSequence();
        this.consume("RBRACKET");

        // Parse optional group modifiers after ]
        const { count, isPrime } = this.parseModifiers();

        /** @type {Move[]} */
        let expanded = [];

        if (sepToken.type === "COMMA") {
            // [A, B] -> A B A' B'
            const aPrime = ScrambleParser.invertMoves(aSequence);
            const bPrime = ScrambleParser.invertMoves(bSequence);
            expanded = [
                ...aSequence.map(m => m.clone()),
                ...bSequence.map(m => m.clone()),
                ...aPrime,
                ...bPrime
            ];
        } else {
            // [A: B] -> A B A'
            const aPrime = ScrambleParser.invertMoves(aSequence);
            expanded = [
                ...aSequence.map(m => m.clone()),
                ...bSequence.map(m => m.clone()),
                ...aPrime
            ];
        }

        // Apply count & prime modifiers to the expanded result
        expanded = ScrambleParser.applyGroupModifiers(expanded, count, isPrime);

        this.currentDepth--;
        return expanded;
    }

    parseGroup() {
        this.checkDepth();
        this.currentDepth++;

        this.consume("LPAREN");
        const innerSequence = this.parseSequence();
        this.consume("RPAREN");

        const { count, isPrime } = this.parseModifiers();

        let expanded = ScrambleParser.applyGroupModifiers(innerSequence, count, isPrime);

        this.currentDepth--;
        return expanded;
    }

    parseModifiers() {
        let count = 1;
        let isPrime = false;

        if (this.peek().type === "NUMBER") {
            const numToken = this.consume("NUMBER");
            count = parseInt(numToken.value, 10);
        }
        if (this.peek().type === "PRIME") {
            this.consume("PRIME");
            isPrime = true;
        }

        return { count, isPrime };
    }

    checkDepth() {
        if (this.currentDepth >= this.maxDepth) {
            throw new SyntaxError(`Maximum nesting depth of ${this.maxDepth} exceeded`);
        }
    }

    /**
     * Inverts a sequence of moves (reverses order and inverts each move).
     * @param {Move[]} moves 
     * @returns {Move[]}
     */
    static invertMoves(moves) {
        const result = [];
        for (let i = moves.length - 1; i >= 0; i--) {
            result.push(moves[i].clone().invert());
        }
        return result;
    }

    /**
     * Repeats and optionally inverts a group move sequence.
     * @param {Move[]} moves 
     * @param {number} count 
     * @param {boolean} isPrime 
     * @returns {Move[]}
     */
    static applyGroupModifiers(moves, count, isPrime) {
        /** @type {Move[]} */
        let repeated = [];
        for (let c = 0; c < count; c++) {
            for (const m of moves) {
                repeated.push(m.clone());
            }
        }
        if (isPrime) {
            repeated = ScrambleParser.invertMoves(repeated);
        }
        return repeated;
    }
}