# Velpari Pseudocode Stage — Community + Official Standards Research Notes

- Date: 2026-09-16
- Author: velpari planning run
- Purpose: Audit the decision to upgrade the Velpari pseudocode stage template + scout prompts. Every field added has at least one cited community or official source. Every field skipped has at least one cited reason.

## Why this exists

The Velpari pseudocode stage (`/velpari-pseudocode`) was last reviewed when the skill markdown was first written. The community and the official standards bodies have not changed, but Velpari itself now supports multi-design projects (`projectNames: [...]`), a tiered MVP (Phase 1 = MVP), and a dedicated `atomic-functions` stage upstream. The pseudocode template should reflect the convergence of community + official practice for these new shapes.

## Sources consulted

### Official standards bodies

1. **IEEE Std 1016-2009** — *Standard for Information Technology — Systems Design — Software Design Descriptions.* Recognizes pseudocode as an acceptable notation for the algorithm viewpoint. Source: https://standards.ieee.org/ieee/1016/4502/
2. **IEEE 12207** — Systems and software engineering — Software life cycle processes. Umbrella standard; calls for design descriptions to declare their notation. Companion to IEEE 1016.
3. **ISO/IEC/IEEE 42010** — Architecture description standard. Builds on IEEE 1016.
4. **V-Model (US government + German V-Modell)** — Software development lifecycle that requires pseudocode in the low-level / module design phase. Source: https://en.wikipedia.org/wiki/V-model_(software_development)
5. **INCOSE Systems Engineering Handbook** — Companion to the US V-Model for defense / aerospace / medical-device work.

### Academic / methodology

6. **Donald Knuth, *The Art of Computer Programming* Vol 1 (1968+)** — Established the dominant academic convention: formal block structure + natural-language commentary.
7. **Tom DeMarco, *Structured Analysis and System Specification* (1978)** — Popularized Structured English as the minispecification format for the lowest-level DFD processes.
8. **Edward Yourdon + Larry Constantine, *Structured Design* (1979)** — Functional decomposition; module description depth should match module complexity and risk.
9. **Bertrand Meyer, *Object-Oriented Software Construction* (1988, 1997)** — Design by Contract: preconditions, postconditions, invariants.
10. **Cal Poly Pseudocode Standard** (Cal Poly CSC dept) — https://users.csc.calpoly.edu/~jdalbey/SWE/pdl_std.html — common university teaching standard. `IF / ELSE / ENDIF`, `WHILE / ENDWHILE`, `FOR / ENDFOR`, `CALL`.
11. **Cormen / Leiserson / Rivest / Stein — *Introduction to Algorithms* (CLRS)** — Structured pseudocode style that influenced generations of CS curricula.

### Modern industry / community

12. **JSDoc (jsdoc.app)** — https://jsdoc.app/ — `@param`, `@returns`, `@throws`, `@example`, `@deprecated`. Used by Google, Microsoft, Facebook.
13. **JavaDoc (Oracle)** — Companion to JSDoc for Java; `@param`, `@return`, `@throws`, `@deprecated`.
14. **Python docstring conventions** — Google style (Args, Returns, Raises); NumPy style; Sphinx style. Empirical Software Engineering paper (Springer 2022) confirms `@param` + `@return` + `@throws` as the 3 universal fields across Java + Python corpora. Source: https://link.springer.com/article/10.1007/s10664-022-10284-6
15. **Roxygen2 (R Packages, 2e)** — https://r-pkgs.org/man.html — `@param`, `@return`, `@examples`, `@seealso`, `@export`.
16. **Google JavaScript Style Guide** — https://google.github.io/styleguide/ — `@param {type} name - description` order.
17. **Microsoft MakeCode function documentation** — https://arcade.makecode.com/courses/csintro3/functions/comments — `@returns`, `@param`, `@throws`.
18. **Wikipedia "Pseudocode"** — https://en.wikipedia.org/wiki/Pseudocode — survey of academic conventions.
19. **Wikipedia "Structured English"** — https://en.wikipedia.org/wiki/Structured_English — IF/THEN/ELSE/ENDIF, DO/WHILE.
20. **Wikipedia "Structured analysis"** — https://en.wikipedia.org/wiki/Structured_analysis — DeMarco / Yourdon / Jackson / Warnier / Orr lineage.
21. **Wikipedia "Design by contract"** — https://en.wikipedia.org/wiki/Design_by_contract — DbC origin and adoption.
22. **Wikipedia "V-model (software development)"** — https://en.wikipedia.org/wiki/V-model_(software_development) — module-design pseudocode mandate.
23. **Linux kernel coding style + kernel-doc** — https://docs.kernel.org/process/coding-style.html — kernel-doc format for function documentation.
24. **UC Berkeley CS162 design doc template** — https://people.eecs.berkeley.edu/~kubitron/courses/cs162-F06/design.html — "purpose of the procedure, and an explanation of how it works and/or pseudocode".
25. **Georgia Tech design doc template** — https://www.cse.unr.edu/~sushil/class/425/templates/gatechdesigndoctemplate — "name of the procedure, its arguments (and their types) and a brief description of what that procedure should do (pseudocode is fine)".
26. **TechTarget — "How to write pseudocode"** — https://www.techtarget.com/searchapparchitecture/tip/How-to-write-pseudocode-A-guided-tutorial — "Use proper indentation... read like a well-written technical document".
27. **Codecademy pseudocode guide** — https://www.codecademy.com/article/pseudocode-and-flowchart-complete-beginners-guide — "Focus on logic flow".
28. **Reddit r/cpp (top-voted on function documentation)** — "Anything at the boundary of a system is usually worth some more comments, especially if there are large numbers of parameters or significant data transformations going on."
29. **Reddit r/learnprogramming (top-voted on pseudocode best practice)** — "There aren't real rules for pseudocode... focus on the algorithmic design so you don't worry about specific language implementation details."

## Field-by-field community consensus

| Field | Sources supporting it | Decision |
|---|---|---|
| Tier stamp (0/1/2/3) | Velpari internal — decision switch for the rubric | ADD |
| Signature (name + params + types) | JSDoc `@param` + JavaDoc + Python docstring + Roxygen2 + V-Model + IEEE 1016 + Linux kernel-doc | ADD (all tiers) |
| Description (1–2 sentences) | UC Berkeley CS162 + Georgia Tech + Google design docs + Microsoft design templates | ADD (Tier 1+) |
| Pseudocode (numbered STEPS) | IEEE 1016 + V-Model + Knuth + Cal Poly + current Velpari skill | ADD (Tier 1+) |
| Returns | JSDoc `@returns` + JavaDoc `@return` + Python `Returns:` + Roxygen2 + V-Model | ADD (Tier 1+) |
| Inputs / Outputs (explicit section) | V-Model + IEEE 1016 + UC Berkeley + Georgia Tech + Linux kernel-doc | ADD (Tier 2+) |
| PRECONDITIONS / POSTCONDITIONS | Design by Contract (Meyer) + current Velpari skill + V-Model (as "pre/post") | ADD (Tier 2+) |
| Edge Cases table | V-Model + current Velpari skill | ADD (Tier 2+) |
| Errors / Throws | JSDoc `@throws` + JavaDoc `@throws` + Python `Raises:` + V-Model error list + Empirical Software Engineering 2022 paper | ADD (Tier 2+) |
| Complexity (Time / Space) | Knuth + Cal Poly + CLRS + current Velpari skill | ADD (Tier 2+) |
| Dependencies (other modules called) | V-Model + Linux kernel-doc (Context) + r/cpp "boundary functions" + Google design docs "interface contracts" | ADD (Tier 3 only) |
| Side effects (state mutated, I/O) | V-Model + r/cpp "things that touch state" + Microsoft PlayCode design template | ADD (Tier 3 only) |
| INVARIANT clause | Only Design by Contract (Meyer Eiffel). NOT in JSDoc, NOT in JavaDoc, NOT in Python docstring, NOT in Roxygen, NOT in Linux kernel-doc, NOT in any industry design-doc template surveyed. | **SKIP** — academic only; would be over-engineering for the 99% of functions that do not need it. Tier 3 gets Dependencies + Side effects instead, which serve the same review purpose (security/payment/distributed functions). |

## The 5-question tier rubric

For each function, ask 5 yes/no questions. The highest YES wins the tier.

1. **Risk** — *If this function is wrong, does money, security, or data get lost or exposed?* YES → minimum Tier 3.
2. **Novelty** — *Is this algorithm invented here, or unknown to this team?* YES → minimum Tier 2.
3. **Complexity** — *Does this function have loops, recursion, multiple branches, or external state?* YES → minimum Tier 2.
4. **MVP-critical** — *Does PRD Phase 1 (MVP) require this function?* YES → minimum Tier 2.
5. **Test-difficulty** — *Can a tester write test cases from the function name + signature alone?* NO → minimum Tier 2.

| Highest YES | Tier |
|---|---|
| None | 0 |
| Only Complexity | 1 |
| MVP-critical, or Complexity + Risk, or Novelty | 2 |
| Risk or full Novelty + Risk | 3 |

## Tier → required field mapping

| Field | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| Tier stamp | required | required | required | required |
| Signature | required | required | required | required |
| Description | — | required | required | required |
| Pseudocode | — | required | required | required |
| Returns | — | required | required | required |
| Inputs / Outputs | — | — | required | required |
| PRECONDITIONS / POSTCONDITIONS | — | — | required | required |
| Edge Cases | — | — | required | required |
| Errors / Throws | — | — | required | required |
| Complexity | — | — | required | required |
| Dependencies | — | — | — | required |
| Side effects | — | — | — | required |

## Rationale for skipping INVARIANT

1. **Industry absence.** JSDoc, JavaDoc, Python docstring, Roxygen2, Linux kernel-doc, Google/Microsoft/UC Berkeley/Georgia Tech design templates all omit it. Adding it would diverge from the community standard the upgrade is built around.
2. **Narrow applicability.** INVARIANT clauses are most useful for classes in Eiffel or languages with native DbC support (Ada 2012, Rust precondition attributes). Velpari target languages (TypeScript/Node) do not have native INVARIANT support.
3. **Dependencies + Side effects cover the same review need.** For security-critical and payment functions (Tier 3), reviewers need to know "what other modules does this call" and "what state does this mutate." Dependencies + Side effects give them that directly. INVARIANT adds a third axis that is rarely actionable in code.
4. **Open for opt-in later.** If a future project needs formal DbC (e.g. medical device, aerospace), the template can be extended with an opt-in INVARIANT block without breaking the community-standard default.

## References

- IEEE Std 1016-2009 — https://standards.ieee.org/ieee/1016/4502/
- IEEE 12207 — Systems and software engineering — Software life cycle processes
- ISO/IEC/IEEE 42010 — Architecture description
- V-Model — https://en.wikipedia.org/wiki/V-model_(software_development)
- Knuth — *The Art of Computer Programming* Vol 1
- DeMarco — *Structured Analysis and System Specification* (1978)
- Yourdon + Constantine — *Structured Design* (1979)
- Meyer — *Object-Oriented Software Construction* (1988, 1997)
- Cal Poly Pseudocode Standard — https://users.csc.calpoly.edu/~jdalbey/SWE/pdl_std.html
- CLRS — *Introduction to Algorithms*
- JSDoc — https://jsdoc.app/
- Empirical Software Engineering 2022 — https://link.springer.com/article/10.1007/s10664-022-10284-6
- R Packages 2e (Roxygen2) — https://r-pkgs.org/man.html
- Google JavaScript Style Guide — https://google.github.io/styleguide/
- Microsoft MakeCode — https://arcade.makecode.com/courses/csintro3/functions/comments
- Linux kernel coding style — https://docs.kernel.org/process/coding-style.html
- UC Berkeley CS162 — https://people.eecs.berkeley.edu/~kubitron/courses/cs162-F06/design.html
- Georgia Tech design doc template — https://www.cse.unr.edu/~sushil/class/425/templates/gatechdesigndoctemplate
- Wikipedia: Pseudocode, Structured English, Structured analysis, Design by contract, V-model (software development)