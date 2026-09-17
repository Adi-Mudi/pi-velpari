# medical-device-b Test Plan extra sections

These headings are appended to the standard testplan template when the
`medical-device-b` overlay is active.

## Verification per IEC 62304 §5.7

For every functional requirement (FR-N) and every non-functional
requirement (NFR-N), document the verification method and the
acceptance criterion. Class B requires every NFR to have a verification
method.

| Req ID | Class | Verification method | Acceptance criterion | Test case(s) |
|---|---|---|---|---|
| FR-1 | A/B/C | Inspection / Test / Analysis | <criterion> | TC-N |
| FR-2 | A/B/C | Inspection / Test / Analysis | <criterion> | TC-N |
| NFR-1 | A/B/C | Inspection / Test / Analysis | <criterion> | TC-N |

Verification method vocabulary:
- **Inspection** — review of artifacts (code, design, docs)
- **Test** — execution against the running system
- **Analysis** — static reasoning, formal methods, or mathematical proof

## Integration Test Coverage (IEC 62304 §5.6)

Class B requires integration tests that exercise the interfaces between
modules. List every inter-module interface and the integration test
that covers it.

| Interface | From → To | Integration test | Result |
|---|---|---|---|
| <iface-1> | <src> → <dst> | IT-N | <pass / fail> |

Integration test coverage metric: **(covered interfaces / total interfaces) ≥ 95%**

## System Test Coverage (IEC 62304 §5.7)

System tests verify that the integrated software meets every FR.
List the system test that covers each FR.

| FR ID | System test | Result |
|---|---|---|
| FR-1 | ST-N | <pass / fail> |

System test coverage metric: **(covered FRs / total FRs) = 100%**

## Risk Control Verification

For every risk control measure in the design doc's `## Risk Control
Measures` table:

| Hazard ID | Risk control | Verification method | Result |
|---|---|---|---|
| H-001 | <measure> | Inspection / Test / Analysis | <pass / fail> |

Risk control verification coverage metric: **(verified controls / total controls) = 100%**

## SOUP Verification (when applicable)

For every SOUP item, verify the integration and test the known
anomaly mitigations.

| SOUP ID | Integration test | Anomaly test | Result |
|---|---|---|---|
| <id> | IT-N | TC-N | <pass / fail> |

## Acceptance Test Report (IEC 62304 §5.8)

Summary of acceptance test results, signed off before release.

| Acceptance criterion | Result | Verified by | Date |
|---|---|---|---|
| All FRs verified | <pass / fail> | <name> | <date> |
| All NFRs verified | <pass / fail> | <name> | <date> |
| Integration tests ≥ 95% coverage | <pass / fail> | <name> | <date> |
| Risk controls verified | <pass / fail> | <name> | <date> |
| Residual risk acceptable | <yes / no> | <name> | <date> |
| Release approved | <yes / no> | <name> | <date> |
