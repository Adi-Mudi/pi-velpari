# medical-device-b PRD extra sections

These headings are appended to the standard PRD template when the
`medical-device-b` overlay is active. Each section is required by the
overlay's doctor gate.

## Software Development Plan

Brief description of the development process used to satisfy IEC 62304
Class B requirements. Reference the quality plan, configuration
management, and problem resolution procedures.

| Item | Reference |
|---|---|
| Quality plan | <path-to-quality-plan> |
| Configuration management | <path-to-cm-plan> |
| Problem resolution | <path-to-issue-tracking> |
| Change control | <path-to-change-control> |

## Software Safety Classification

The device's software safety class per IEC 62304 §4. This overlay is
designed for **Class B** (non-serious injury possible). For Class C
(serious injury or death), use the `medical-device-c` overlay instead.

| Subsystem | Class | Rationale |
|---|---|---|
| <subsystem-1> | A / B / C | <why this class> |
| <subsystem-2> | A / B / C | <why this class> |
| <subsystem-N> | A / B / C | <why this class> |

If the device contains subsystems with different classes, document each
one's class separately. The overall device class is the highest class
of any subsystem.

## Risk Management Summary

Brief summary of the risk management activities per ISO 14971:2019.
This section does NOT replace a full risk management file — it points
to one.

- Risk management file: <path>
- Risk analysis method: <e.g. FMEA, FTA, HAZOP>
- Risk evaluation criteria: <e.g. severity × probability matrix>
- Overall residual risk: <acceptable / not acceptable>
- Risk-benefit analysis: <required if not acceptable>

### Identified hazards (summary)

| ID | Hazard | Severity | Probability | Risk control | Trace to design |
|---|---|---|---|---|---|
| H-001 | <hazard> | <sev> | <prob> | <control> | <design-element> |
| H-002 | <hazard> | <sev> | <prob> | <control> | <design-element> |

## SOUP Inventory (when applicable)

If the device integrates any SOUP (Software of Unknown Pedigree per
IEC 62304 §8), list each item with version, supplier, intended use,
and known anomalies.

| SOUP ID | Name | Version | Supplier | Intended use | Known anomalies |
|---|---|---|---|---|---|
| <id> | <name> | <ver> | <sup> | <use> | <anomalies> |

A SOUP-free device can omit this section.

## Acceptance Criteria — IEC 62304 Specific

Acceptance criteria for the IEC 62304-specific processes:

| Process | Acceptance criterion | Verified by |
|---|---|---|
| §5.1 Development plan | Plan exists, reviewed, approved | Plan review |
| §5.2 Requirements analysis | All FRs have safety class | Design review |
| §5.3 Architectural design | Module-level safety class assigned | Safety analyzer scout |
| §5.6 Integration testing | Integration test coverage ≥ 95% | Test execution |
| §5.7 System testing | All FRs verified by test or inspection | Test execution |
| §5.8 Release | Release notes include risk summary | Release audit |
