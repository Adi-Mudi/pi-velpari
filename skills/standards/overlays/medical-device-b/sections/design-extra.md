# medical-device-b Design extra sections

These headings are appended to the standard design template when the
`medical-device-b` overlay is active.

## Software Architectural Design (IEC 62304 §5.3)

Describe the software architecture at a level sufficient to demonstrate
that the safety class B requirements can be met. Cover:

1. **Module decomposition** with explicit safety class per module
2. **Interfaces** between modules (signatures, data flow, error handling)
3. **Segregation** of safety-critical modules (separation of concerns)
4. **External dependencies** (libraries, frameworks, services) and their safety impact

### Module Safety Classification

| Module | IEC 62304 Class | Risk control references | Notes |
|---|---|---|---|
| <module-1> | A / B / C | H-001, H-005 | <segregation notes> |
| <module-2> | A / B / C | H-002 | <segregation notes> |
| <module-N> | A / B / C | <hazards> | <segregation notes> |

Every Class B module MUST have at least one risk control reference
(Class A modules may have zero). Class C modules (if any) require
separate handling beyond this overlay's scope.

### Interface Safety Analysis

For each inter-module interface:

| Interface | From → To | Data | Error handling | Class |
|---|---|---|---|---|
| <iface-1> | <src> → <dst> | <payload> | <error strategy> | A/B/C |

### External Dependency Safety

| Dependency | Version | Supplier | Safety impact | Anomaly handling |
|---|---|---|---|---|
| <dep-1> | <ver> | <sup> | <impact> | <strategy> |

## Risk Control Measures

For every hazard identified in the PRD's `## Risk Management Summary`,
list the risk control measure(s) and the design element(s) that
implement them.

| Hazard ID | Risk control measure | Design element | Verification |
|---|---|---|---|
| H-001 | <measure> | <module / interface> | <how verified> |
| H-002 | <measure> | <module / interface> | <how verified> |

The `design-safety-analyzer` scout (overlay role
`overlay-design-safety-analyzer`) verifies that every accepted ADR
maps to a hazard + risk control in this table.

## Software Detailed Design (IEC 62304 §5.4 — recommended for Class B)

> IEC 62304 §5.4 is RECOMMENDED for Class B (mandatory for Class C).
> This overlay adds the section but does not require its contents —
> include detailed design when the architecture has complex safety
> logic.

| Module | Sub-routine / class | Behavior summary | Safety relevance |
|---|---|---|---|
| <module> | <sub-routine> | <summary> | <class + rationale> |

Omit this section if the architecture is simple enough that the
architectural design + interface analysis already establish the
required level of detail.

## SOUP Risk Control

For every SOUP item listed in the PRD's `## SOUP Inventory`:

| SOUP ID | Known anomalies | Risk control measure | Residual risk |
|---|---|---|---|
| <id> | <anomalies> | <measure> | <acceptable / not> |
