# Cube Capo
A tool for generating more ergonomic versions of Rubik's cube scrambles.

### Current features
- Tracking of likely thumb positions and fingertricks in 3x3 scrambles
- Cost analysis of scrambles using customizable values
- Optimization by branching with wide-move or double-prime replacements, searching multiple starting orientations
- Memoization and pruning to reduce running time (though it can still be slow with large scrambles)
- Injection of transposed scrambles into websites like csTimer
 
 ### Current limitations
 - Unhelpful output for big cubes, since the grip transitions were made with 3x3 in mind.
 - Grip transitions were created using what I personally would do in the specific situation. There may be differences between my style and yours that causes inaccuracy in the predicted grip or fingertrick.
   - The configuration file is very large, so changing it is probably not approachable for the end user.
 - No "thumb" type fingertricks
 - Limited view of the hand state beyond thumb placement; sometimes the output contains moves that are good on paper but awkward in practice.
 - No analysis for rotations or slice moves yet.

## Screenshots
<details>
<summary>Main Page</summary>
<img width="1884" height="1072" alt="ss" src="https://github.com/user-attachments/assets/1b51e1ab-f9dd-44aa-9a5b-3e20e79832cd" />
</details>
