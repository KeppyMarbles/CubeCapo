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
├── assets/                  # SVG icons, used as CSS mask icons (link, unlink, github, copy, rename, file-export, trash-can, reset)
├── data/
│   └── scrambles.txt        # 100 newline-separated 3x3 scrambles for testing and statistical analysis
├── scratch/                 # Test script folder for agents. Excluded from git.
├── shared/
│   ├── defaults.js          # Default configurations: `defaultColorScheme`, `defaultFormatOptions`, `defaultSearchOptions`, `defaultScrambleOptions`, `defaultRunOptions`, `defaultCostConfiguration`, `defaultFingertricks`, `strategyPresets`
│   ├── profiles.js          # Profile type, built-in Default profile, storage helpers for saved profiles / active profile name, and imported profile parsing
│   ├── storage.js           # Cross-environment storage helper (chrome.storage.local with localStorage fallback) and the SETTINGS_CHANGED tab notification
│   ├── cube/
│   │   ├── evaluator.js     # ExecutionEvaluator class: 5-state thumb/wrist model, pre-computed transitionCache, transition cost evaluation, candidate regrip search
│   │   ├── move.js          # Move class: copy/clone/invert methods, transposition matrix, rotation helpers, ALPHAS index lists
│   │   ├── optimizer.js     # ScrambleOptimizer class: integer-based branch-and-bound search, partition sequencing, orientation search, candidate management
│   │   ├── rotations.js     # Lookup tables for the search: cube orientations, face permutations from rotations, wide move rotations, all indexed by integer
│   │   ├── parser.js        # ScrambleParser class: tokenization, recursive descent parsing for commutators/conjugates/groups, notation detection & normalization
│   │   └── util.js          # Cube utility functions: normalizeScramble, getFinalOrientation, getOrientationColors, getRestoringRotation, detectCubeSize
│   ├── ui/
│   │   ├── dom.js           # Type-safe DOM element getters & query helpers (getElement, getOptionalElement, queryElement, queryElementOptional, queryElements)
│   │   ├── form.js          # Form handler: input parsing, cost config tab setup, profile list (cards from a <template>, delegated actions: activate/reset/rename/clone/export/delete/import), autosave to the active profile
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
5. Save temporary test scripts and verification files directly in the workspace `scratch/` folder so that project-relative imports (e.g. `../shared/...`) and ES module package boundaries resolve cleanly.
6. Be mindful of scratch script runtime. Time them out after 10 seconds, or keep watch on their progress.
7. Update this file if it becomes outdated or has errors.