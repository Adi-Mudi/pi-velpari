# cloud-saas Test Plan extra sections

These headings are appended to the standard testplan template when the
`cloud-saas` overlay is active.

## SOC 2 Control Tests

For every SOC 2 control marked `applies` in the PRD's
`## SOC 2 Control Inventory`, document the test.

| Control ID | Test ID | Test description | Frequency | Last run | Result |
|---|---|---|---|---|---|
| CC6.1 | TEST-N | Verify MFA enforcement; attempt bypass | quarterly | <date> | <pass / fail> |
| CC6.2 | TEST-N | Verify new user authorization flow | quarterly | <date> | <pass / fail> |
| CC6.3 | TEST-N | Verify access removal on termination | quarterly | <date> | <pass / fail> |
| CC7.2 | TEST-N | Verify audit log completeness | monthly | <date> | <pass / fail> |
| A1.2 | TEST-N | Verify availability commitment met | monthly | <date> | <pass / fail> |

Coverage metric: **(SOC 2 controls with tests / SOC 2 controls that apply) ≥ 90%**

## Penetration Testing

The penetration test plan per SOC 2 CC7 + ISO 27001 A.8.8.

| Test ID | Target | Method | Frequency | Last run | Next run | Result |
|---|---|---|---|---|---|---|
| PT-EXT | External network | <method> | annually | <date> | <date> | <pass / fail> |
| PT-INT | Internal network | <method> | annually | <date> | <date> | <pass / fail> |
| PT-APP | Application-layer (OWASP Top 10) | <method> | annually + per release | <date> | <date> | <pass / fail> |
| PT-CLOUD | Cloud config (CIS benchmarks) | <method> | quarterly | <date> | <date> | <pass / fail> |

### OWASP Top 10 coverage

| Risk | Tested? | Last test | Notes |
|---|---|---|---|
| A01 Broken Access Control | yes / no | <date> | <notes> |
| A02 Cryptographic Failures | yes / no | <date> | <notes> |
| A03 Injection | yes / no | <date> | <notes> |
| A04 Insecure Design | yes / no | <date> | <notes> |
| A05 Security Misconfiguration | yes / no | <date> | <notes> |
| A06 Vulnerable Components | yes / no | <date> | <notes> |
| A07 Auth Failures | yes / no | <date> | <notes> |
| A08 Software & Data Integrity | yes / no | <date> | <notes> |
| A09 Logging & Monitoring | yes / no | <date> | <notes> |
| A10 SSRF | yes / no | <date> | <notes> |

## Availability Tests (RTO / RPO)

For every service tier, verify the documented RTO and RPO.

| Tier | RTO target | Achieved RTO | RPO target | Achieved RPO | Test ID | Result |
|---|---|---|---|---|---|---|
| Tier-1 | 1 hour | <actual> | 15 min | <actual> | AT-001 | <pass / fail> |
| Tier-2 | 4 hours | <actual> | 1 hour | <actual> | AT-002 | <pass / fail> |
| Tier-3 | 24 hours | <actual> | 4 hours | <actual> | AT-003 | <pass / fail> |

Test methodology:

1. Inject a failure (region kill, database corruption)
2. Measure time to recovery (RTO) and data loss (RPO)
3. Compare against target
4. Document any gaps + remediation plan

## Backup and Recovery Tests

For every backup type, verify restore works.

| Backup type | Test ID | Test description | Last run | Next run | Result |
|---|---|---|---|---|---|
| Full | BR-001 | Restore full backup to clean environment | <date> | <date> | <pass / fail> |
| Incremental | BR-002 | Restore full + incremental | <date> | <date> | <pass / fail> |
| PITR | BR-003 | Restore to point-in-time (T-15min) | <date> | <date> | <pass / fail> |

The overlay requires:

- Restore test at least quarterly (Tier-1) / semi-annually (Tier-2)
- Every test restores to an isolated environment
- Restore time recorded + compared against RTO
- Data loss recorded + compared against RPO

## Access Control Tests

Verify the IAM design holds.

| Test ID | Test description | Expected | Last run | Result |
|---|---|---|---|---|
| AC-001 | User attempts cross-tenant access | Blocked | <date> | <pass / fail> |
| AC-002 | User attempts unauthorized role action | Blocked | <date> | <pass / fail> |
| AC-003 | Admin attempts access without MFA | Blocked | <date> | <pass / fail> |
| AC-004 | Terminated user attempts access | Blocked | <date> | <pass / fail> |
| AC-005 | Audit log tampering attempt | Detected | <date> | <pass / fail> |

Frequency: monthly for AC-001 through AC-004 (automated), quarterly for
AC-005 (manual red-team).
