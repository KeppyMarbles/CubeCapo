# Cube Capo
A tool for generating more ergonomic versions of Rubik's cube scrambles.

### Current features
- Tracking of likely thumb positions and fingertricks in 3x3 scrambles
- Cost analysis of scrambles using customizable values
- Optimization by branching with wide-move or double-prime replacements, searching multiple starting orientations
- Memoization, pruning, and partitioning to control runtime
- Injection of transposed scrambles into websites like csTimer
 
 ### Current limitations
 - Sub-par output for 6x6 and above
 - Slice moves, rotations, and commutators/conjugates allowed in input but not output
 - Single-slice big cube moves (like those in 4x4 PLL parity) not allowed

## Screenshots
<details>
<summary>Main Page</summary>
<img width="1884" height="1072" alt="ss" src="https://github.com/user-attachments/assets/1b51e1ab-f9dd-44aa-9a5b-3e20e79832cd" />
</details>
