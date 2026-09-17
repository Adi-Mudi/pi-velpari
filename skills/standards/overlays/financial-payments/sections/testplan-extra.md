# financial-payments Test Plan extra sections

These headings are appended to the standard testplan template when the
`financial-payments` overlay is active.

## PCI Compliance Tests

For every PCI-DSS requirement marked `applies` in the PRD's
`## PCI Compliance Matrix`, document the test.

| PCI-DSS § | Test ID | Test description | Result | Verified by |
|---|---|---|---|---|
| §1.4 | TEST-N | Verify CDE is isolated; attempt cross-zone access | <pass / fail> | <name> |
| §3.5.1 | TEST-N | Verify PAN encryption at rest; inspect storage | <pass / fail> | <name> |
| §3.6 | TEST-N | Verify key rotation per documented interval | <pass / fail> | <name> |
| §4.2 | TEST-N | Verify TLS 1.2+; attempt downgrade | <pass / fail> | <name> |
| §7 | TEST-N | Verify least privilege; attempt unauthorized access | <pass / fail> | <name> |
| §8 | TEST-N | Verify MFA enforcement; attempt MFA bypass | <pass / fail> | <name> |
| §10 | TEST-N | Verify audit log completeness; attempt log tampering | <pass / fail> | <name> |

Coverage metric: **(PCI requirements with tests / PCI requirements that apply) = 100%**

## Penetration Test Plan

The penetration test plan per PCI-DSS §11.

| Test ID | Target | Method | Frequency | Last run | Next run |
|---|---|---|---|---|---|
| PT-EXT | External network | <method> | annually | <date> | <date> |
| PT-INT | Internal CDE + connected-to | <method> | annually | <date> | <date> |
| PT-APP | Application-layer (OWASP) | <method> | annually + per release | <date> | <date> |
| PT-WEB | Web app (if applicable) | <method> | annually | <date> | <date> |

### Findings register

| Finding ID | Description | Severity | Status | Remediation |
|---|---|---|---|---|
| F-001 | <finding> | Critical / High / Med / Low | Open / Closed | <fix> |

The overlay requires:

- Annual external + internal penetration test
- Application-layer test after every significant change
- Critical / High findings remediated before the next annual test
- ASV (Approved Scanning Vendor) scan quarterly for external-facing systems

## Audit Log Verification

Verify that every event in the PRD's `## Audit Logging Requirements`
table is actually logged.

| Event type | Log produced? | Fields match? | Tamper-evident? |
|---|---|---|---|
| User authentication | yes / no | yes / no | yes / no |
| CHD access | yes / no | yes / no | yes / no |
| Privileged action | yes / no | yes / no | yes / no |
| Key access | yes / no | yes / no | yes / no |
| Config change | yes / no | yes / no | yes / no |
| Audit log access | yes / no | yes / no | yes / no |

The overlay requires:

1. **Completeness** — every required event is logged
2. **Field match** — every required field is present
3. **Tamper evidence** — log records cannot be modified without detection
4. **Retention** — ≥ 12 months (3 months online minimum)
5. **Daily review** — SIEM rules reviewed daily

## Segregation of Duties Tests

Verify the segregation rules from the PRD's `## Segregation of Duties`
table.

| Test ID | Test description | Expected | Actual |
|---|---|---|---|
| SOD-001 | Developer attempts to deploy to prod | Blocked | <pass / fail> |
| SOD-002 | Deployer attempts to access CHD | Blocked | <pass / fail> |
| SOD-003 | Auditor attempts to modify config | Blocked | <pass / fail> |
| SOD-004 | DBA attempts to access audit logs | Blocked | <pass / fail> |
| SOD-005 | Security admin attempts to view CHD | Blocked | <pass / fail> |

The overlay requires:

- Every conflicting role pair has a test
- Every test runs at least quarterly
- Failures trigger immediate access review

## Key Rotation Tests

Verify that keys rotate at the documented interval and that retired
keys are destroyed.

| Key ID | Documented interval | Last rotation | Next rotation | Destruction verified? |
|---|---|---|---|---|
| K-001 | <interval> | <date> | <date> | yes / no |
| K-002 | <interval> | <date> | <date> | yes / no |

The overlay requires:

- Test that each key rotates per schedule (run a forced rotation in
  test)
- Test that retired keys cannot decrypt new data
- Test that destruction certificate is generated and stored
