# AGENTS.md

## Project Overview

**Cube Capo** (also referenced as `scramblemanip-js`) is a JavaScript application and WebExtension tool designed to analyze Rubik's Cube scrambles and generate ergonomics-optimized, transposed scrambles with fingertrick and regrip details.

The tool parses scrambles, searches starting cube orientations and starting thumb placements (grips), evaluates transition costs using customizable fingertrick and grip penalty parameters, and replaces movements (e.g. replacing normal turns with wide moves or prime variations) to discover the path with the lowest overall cost while maintaining functional equivalence.

---

## Directory & File Structure

```
scramblemanip-js/
├── main.js                  # Entry point for web app (connects form, optimizer, stats)
├── benchmark.js             # Performance test & benchmark runner for 100 scrambles (npm test)
├── index.html               # Web UI layout (Scramble input, format, computation settings, stats tables, cost config tabs)
├── styles.css               # Web UI CSS styles (modern, dark/light theme options, grid layouts)
├── package.json             # ES Module declaration ("type": "module") & npm test script
├── manifest.json            # WebExtension (Manifest V3) definition
├── assets/                  # SVG icons (link.svg, unlink.svg, github.svg)
├── data/
│   └── scrambles.txt        # 100 newline-separated 3x3 scrambles for testing and statistical analysis
├── scratch/                 # Test script folder for agents. Excluded from git.
├── shared/
│   ├── types.js             # JSDoc type definitions (@typedef for Move, CostConfig, Transition, Options, etc.)
│   ├── cube/
│   │   ├── defaults.js      # `defaultColorScheme`, `defaultFormatOptions`, `defaultRunOptions`, `defaultCostConfiguration`, `defaultFingertricks` (`{ right, left? }` 5-state thumb model).
│   │   ├── move.js          # Move class: copy/clone/invert methods, transposition matrix, linear chain state transitions, rotation helpers
│   │   ├── optimizer.js     # ScrambleOptimizer class: branch-and-bound optimization, pre-computed transitionCache, fast top-K regrip candidate search (findCandidateRegrips), static addCandidate and getCandidateSignature helpers
│   │   ├── parser.js        # ScrambleParser class: tokenization, recursive descent parsing for commutators/conjugates/groups, notation detection & normalization
│   │   └── util.js          # Cube utility functions: getOrientationColors, getRestoringRotation, detectCubeSize
│   ├── ui/
│   │   ├── dom.js           # Type-safe DOM element getters & query helpers (getElement, getOptionalElement, queryElement, queryElementOptional, queryElements)
│   │   ├── form.js          # Form handler: input parsing, cost config tab setup, import/export, unsaved bar
│   │   └── stats.js         # Optimization stats: CSS bar chart, breakdown table renderer, orientation matrix, cost color mapping
└── extension/
    ├── background.js        # Service worker: handles async OPTIMIZE_SCRAMBLE & OPEN_OPTIONS_PAGE messages
    ├── contentLauncher.js   # Content script entry point: dynamically imports content.js as an ES module
    ├── content.js           # Content script: DOM observer for web timers (e.g. csTimer), visual overlay, element picker
    ├── content.css          # Injected content script styles for badge, overlay, and details popup table
    ├── popup.html           # Extension popup HTML layout
    ├── popup.js             # Extension popup logic (picker trigger, toggle extension state, options shortcut)
    └── popup.css            # Extension popup CSS styles
```

## Key Conventions & Practices

1. Use `npm run typecheck` after making code changes.
2. Avoid using type assertions to satisfy the type checker.
3. Avoid hardcoding default values. For example, only say `const cubeSize = size || 3` if this is the first occurence of `3`. Do not use fallbacks if they could conceal an error. For example, the text `undefinedxundefined` is preferred over `3x3`.
4. Do not use inline imports for js types; import them at the top of the file.
5. Update this file if it becomes outdated or has errors.