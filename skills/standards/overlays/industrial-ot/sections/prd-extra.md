# industrial-ot PRD extra sections

These headings are appended to the standard PRD template when the
`industrial-ot` overlay is active. Each section is required by the
overlay's doctor gate.

## Safety Integrity Level Classification

The Safety Integrity Level (SIL) classification for each safety-related
function per IEC 61508 §4. The class is derived from the hazard
analysis, not picked here — pick the SIL that the HAZOP demands.

| Function ID | Function description | SIL | PFH target | Rationale |
|---|---|---|---|---|
| SRF-001 | <safety function> | 1 / 2 / 3 / 4 | <PFH range> | <HAZOP outcome> |
| SRF-002 | <safety function> | 1 / 2 / 3 / 4 | <PFH range> | <HAZOP outcome> |

If a SIL 4 function exists, document the additional measures taken
(redundancy, diversity, diagnostic coverage).

## Functional Safety Plan

The plan that governs how functional safety is achieved and maintained
throughout the lifecycle (IEC 61508 §5.2.1).

| Item | Reference |
|---|---|
| Safety lifecycle | <path-to-safety-lifecycle-doc> |
| Verification strategy | <path-to-verification-plan> |
| Validation strategy | <path-to-validation-plan> |
| Configuration management | <path-to-cm-plan> |
| Change control | <path-to-change-control-procedure> |
| Competence management | <path-to-competence-matrix> |

## Hazard and Operability Study

Summary of the HAZOP / FMEA / FTA work that drives the SIL
classification. The overlay does not pick a methodology — pick one
and document it here.

- Methodology chosen: <FMEA / FTA / HAZOP / Other>
- Node / scope: <list of process units covered>
- Team: <HAZOP team composition>
- Output: <path-to-full-hazop-document>

### Identified hazards (summary)

| Hazard ID | Hazard description | Cause | Consequence | Severity | Likelihood | SIL target |
|---|---|---|---|---|---|---|
| H-001 | <hazard> | <cause> | <consequence> | <sev> | <prob> | 1 / 2 / 3 / 4 |
| H-002 | <hazard> | <cause> | <consequence> | <sev> | <prob> | 1 / 2 / 3 / 4 |

## Cybersecurity Zones and Conduits

The industrial network is partitioned into zones (groups of assets
sharing a security policy) connected by conduits (controlled paths)
per IEC 62443-3-3.

| Zone ID | Zone purpose | Assets | SL-T (target) |
|---|---|---|---|
| Z-001 | <zone> | <asset list> | 1 / 2 / 3 / 4 |
| Z-002 | <zone> | <asset list> | 1 / 2 / 3 / 4 |

| Conduit ID | From zone → To zone | Allowed protocols | Authentication |
|---|---|---|---|
| C-001 | <zone-A> → <zone-B> | <protocol list> | <auth method> |
| C-002 | <zone-A> → <zone-B> | <protocol list> | <auth method> |

The overlay does not enforce the security level — pick it from the
risk assessment. Document the chosen SL-T.

## Safety Lifecycle

The IEC 61508 lifecycle phases this product follows. Mark each phase
as `in scope` / `out of scope` / `not applicable`.

| Phase | IEC 61508 § | In scope? | Evidence |
|---|---|---|---|
| Concept | §5.2.1 | in scope | brainstorm notes |
| Scope | §5.2.4 | in scope | PRD §Scope |
| Hazard & risk analysis | §5.2.6 | in scope | §Hazard and Operability Study |
| Overall safety requirements | §5.2.7 | in scope | §SIL Classification |
| Safety requirements allocation | §5.2.8 | in scope | Design §SIL Decomposition |
| Realisation | §5.2.9 | in scope | Senai implementation |
| Overall validation | §5.2.11 | in scope | Testplan §SIL Verification |
| Overall operation, maintenance | §5.2.10 | out of scope | (operations, not Velpari scope) |
| Functional safety assessment | §5.2.12 | in scope | Testplan §FMEA Verification |
