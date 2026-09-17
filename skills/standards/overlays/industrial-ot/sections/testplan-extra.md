# industrial-ot Test Plan extra sections

These headings are appended to the standard testplan template when the
`industrial-ot` overlay is active.

## SIL Verification Coverage

For every safety-related function (SRF), document the verification
method and the achieved SIL. The verification method is one of:

- **Inspection** — review of artifacts (design, code, FMEDA)
- **Test** — execution against the running system
- **Analysis** — statistical reasoning (FMEDA, reliability prediction)

| Function ID | Required SIL | Achieved SIL | PFH achieved | Verification method | Acceptance criterion | Test reference |
|---|---|---|---|---|---|---|
| SRF-001 | <SIL> | <SIL> | <PFH> | Inspection / Test / Analysis | <criterion> | <test ID> |
| SRF-002 | <SIL> | <SIL> | <PFH> | Inspection / Test / Analysis | <criterion> | <test ID> |

The overlay requires:

- All SIL 3 / SIL 4 functions verified by Test + Analysis
- Diagnostic coverage ≥ 90% for SIL 3 / SIL 4
- PFH achieved ≤ PFH target for every function

## Integration Test Coverage (OT)

Integration tests that exercise the SIS interfaces. List every
SIS-to-SIS or SIS-to-BPCS interface and the test that covers it.

| Interface | From → To | Integration test | Result |
|---|---|---|---|
| <iface-1> | <src> → <dst> | IT-N | <pass / fail> |

Integration test coverage metric: **(covered interfaces / total SIS interfaces) ≥ 95%**

## Cybersecurity Penetration Tests

Penetration test plan and results for the OT network.

| Test ID | Target | Method | Finding | Severity | Status |
|---|---|---|---|---|---|
| PT-001 | <zone / conduit> | <method> | <finding> | <sev> | <open / closed> |

Penetration test frequency: at least annually, plus after every
architecture change.

### Foundational Requirements coverage (IEC 62443-3-3)

| FR | Description | Implemented? | Evidence |
|---|---|---|---|
| FR 1 | Identification & authentication | yes / partial / no | <evidence> |
| FR 2 | Use control | yes / partial / no | <evidence> |
| FR 3 | System integrity | yes / partial / no | <evidence> |
| FR 4 | Data confidentiality | yes / partial / no | <evidence> |
| FR 5 | Restricted data flow | yes / partial / no | <evidence> |
| FR 6 | Timely response to events | yes / partial / no | <evidence> |
| FR 7 | Resource availability | yes / partial / no | <evidence> |

## Proof Test Coverage

For every SRF, document the proof test — the manual or automatic test
that detects dangerous undetected failures.

| Function ID | SIL | Proof test ID | Interval | Detection method | Coverage |
|---|---|---|---|---|---|
| SRF-001 | <SIL> | PT-N | <interval> | <method> | <%> |
| SRF-002 | <SIL> | PT-N | <interval> | <method> | <%> |

Aggregate proof test coverage: **(covered SRFs / total SRFs) = 100%**

## FMEA Verification

Verification that the FMEA in the design doc is complete and
internally consistent.

| Check | Result | Evidence |
|---|---|---|
| Every subsystem has ≥ 1 FMEA row | <pass / fail> | <evidence> |
| Every SIL 3/4 subsystem has dangerous-undetected analysis | <pass / fail> | <evidence> |
| Common-cause failures identified for every SIL decomposition | <pass / fail> | <evidence> |
| Diagnostic coverage claimed matches FMEDA calculation | <pass / fail> | <evidence> |
