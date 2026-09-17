# IEC 62304:2006 Class B — Research Notes

> Authoring notes for `medical-device-b`. Captures what the overlay
> enforces, why, and the standards it references. Not normative for
> IEC 62304 itself — see the official standard for authoritative text.

## Software safety classification (IEC 62304 §4)

| Class | Possible injury | Documentation depth |
|---|---|---|
| A | No injury | Minimal |
| B | Non-serious injury | Moderate — this overlay |
| C | Serious injury or death | Full (out of scope for v1.0) |

Class **B** means: a software failure could cause non-serious injury.
The overlay enforces Class B documentation requirements without forcing
Class C overhead.

## Class B mandatory processes (IEC 62304 §5)

| Process | Required for Class B? | Overlay section |
|---|---|---|
| §5.1 Software development planning | Yes | PRD §Software Development Plan |
| §5.2 Software requirements analysis | Yes | PRD §Software Requirements Specification (covered by base PSRS) |
| §5.3 Software architectural design | **Yes (new section)** | Design §Software Architectural Design |
| §5.4 Software detailed design | Recommended (not mandatory) | (out of scope for v1.0) |
| §5.5 Software unit implementation | Yes | (standard implementation, no overlay section) |
| §5.6 Software integration & integration testing | Yes | Testplan §Integration Test Coverage |
| §5.7 Software system testing | Yes | Testplan §System Test Coverage |
| §5.8 Software release | Yes | (covered by `the publish tool`) |

## Risk management (ISO 14971:2019)

Class B does not require a full ISO 14971 implementation, but the overlay
captures a **Risk Management Summary** so the developer sees the risk
profile before design. The `design-safety-analyzer` scout then maps every
design decision back to a risk control measure.

## SOUP (Software of Unknown Pedigree) — IEC 62304 §8

SOUP items must be:
1. Listed in the PRD with version + supplier + intended use
2. Evaluated for hazards in the risk management summary
3. Tested for known anomalies

The overlay does NOT add a dedicated SOUP section in v1.0 — the developer
captures SOUP items via the standard FR/NFR tables. Future versions may
add a dedicated `## SOUP Inventory` section.

## Safety class mapping for design decisions

Every design decision in `## Architecture Decisions` must carry a safety
class (A/B/C). The `design-safety-analyzer` scout:

1. Reads every ADR + every published artifact
2. Maps each module / interface / data flow to A/B/C
3. Flags any accepted ADR that lacks a safety class
4. Reports findings to the parent LLM for inclusion in the published design doc

## Verification methods per requirement (Class B)

Class B requires every NFR to have a verification method. The overlay
adds a `## Verification Matrix` section to the testplan that maps each
NFR to its verification approach (inspection / analysis / test).

## What the overlay does NOT enforce

- Hazard analysis traceability to code (Class C territory)
- Formal methods (Class C territory)
- Cybersecurity controls (covered by `industrial-ot` overlay, not this one)
- HIPAA / GDPR privacy (covered by `us-healthcare-phi` and `eu-personal-data` overlays)

## Standards referenced

- **IEC 62304:2006** — Medical device software — Software life cycle processes
- **ISO 14971:2019** — Application of risk management to medical devices
- **ISO 13485:2016** — Medical devices — Quality management systems

## Future versions

- v1.1 — add `## SOUP Inventory` section (when Class B projects need it)
- v1.2 — add `medical-device-c` overlay for Class C
