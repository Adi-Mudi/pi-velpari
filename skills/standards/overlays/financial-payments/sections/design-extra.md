# financial-payments Design extra sections

These headings are appended to the standard design template when the
`financial-payments` overlay is active.

## Network Segmentation (CDE Isolation)

The network design that isolates the CDE per PCI-DSS §1.4.

| Zone ID | Zone purpose | Network segment | CDE? | Allowed conduits |
|---|---|---|---|---|
| Z-CDE | CDE core | <segment> | yes | <conduit list> |
| Z-CTO | Connected-to | <segment> | partial | <conduit list> |
| Z-OUT | Out-of-scope | <segment> | no | <conduit list> |

| Conduit ID | From → To | Protocol allowlist | Authentication | Inspection |
|---|---|---|---|---|
| C-001 | Z-OUT → Z-CTO | <protocol list> | MFA + certificate | IDS + WAF |
| C-002 | Z-CTO → Z-CDE | <protocol list> | MFA + certificate | IDS + WAF |

The overlay enforces:

1. **No direct conduit from Z-OUT to Z-CDE** — all traffic goes through
   Z-CTO (per PCI-DSS §1.4)
2. **No CHD in Z-CTO** — connected-to systems may process CHD only
   ephemerally; persistent storage is CDE-only
3. **Default deny** on every firewall

## Encryption Strategy

The encryption strategy per PCI-DSS §3.5 + §4.2.

### At rest

| Data store | Data type | Algorithm | Key length | Key reference |
|---|---|---|---|---|
| <store-1> | PAN | AES | 256 | <key id> |
| <store-2> | Cardholder name + PAN index | AES | 256 | <key id> |
| <store-3> | Tokens | AES | 256 | <key id> |

### In transit

| Communication | Protocol | TLS version | Certificate authority |
|---|---|---|---|
| <comm-1> | TLS | 1.2 or 1.3 | <CA> |
| <comm-2> | mTLS | 1.2 or 1.3 | <CA> |

### In use

Cardholder data in memory is NEVER logged or printed. Use:

- Secure memory regions (mlock / VirtualLock)
- Tokenization (replace PAN with opaque token in non-CDE systems)
- Format-preserving encryption (FPE) for display

### PAN masking

When PAN is displayed (UI, logs, audit reports), only the first 6 and
last 4 digits are visible:

```
Original:    4111 1111 1111 1234
Displayed:   4111 11XX XXXX 1234
```

The overlay enforces that every UI + every log path applies this mask.

## Key Management Architecture

The design that implements the Key Management Requirements from the PRD.

| Key ID | Purpose | Custodian | Storage | Rotation | Backup |
|---|---|---|---|---|---|
| K-001 | <purpose> | <role> | HSM | <interval> | dual-site |
| K-002 | <purpose> | <role> | HSM | <interval> | dual-site |

Key lifecycle:

1. **Generation** — in HSM, dual-controlled
2. **Distribution** — split knowledge (no single person has the full key)
3. **Storage** — HSM only (no software keys at rest)
4. **Use** — wrapped via HSM API; never enters application memory
5. **Rotation** — at end of cryptoperiod; old key archived (encrypted
   under successor)
6. **Retirement** — securely destroyed (HSM zeroization + certificate)

The overlay enforces:

- All key operations use HSM APIs (no software-only key handling)
- Key custodians are documented per key
- Dual-control for key generation + rotation

## Access Control Model

Access control per PCI-DSS §7 + §8.

| Role | Authentication | Authorization model | MFA? | Re-auth interval |
|---|---|---|---|---|
| <role-1> | password + MFA | RBAC + least privilege | yes | 12 hours |
| <role-2> | certificate + MFA | ABAC (time + location) | yes | per-request |

Requirements:

1. **Default deny** — no access without explicit grant
2. **Least privilege** — every role has the minimum needed
3. **Need-to-know** for CHD — access granted only for documented
   business purpose
4. **MFA for all CDE access** (PCI-DSS §8.4.2)
5. **Quarterly access review** — manager signs off
6. **Immediate revocation** — termination triggers access removal
   within 24 hours

## Audit Log Architecture

The design that implements the audit logging requirements.

| Log stream | Producer | Consumer | Retention | Storage |
|---|---|---|---|---|
| auth.log | auth service | SIEM | 12 months | write-once |
| data-access.log | CDE app | SIEM | 12 months | write-once |
| key-access.log | HSM | SIEM | 12 months | write-once |
| config-change.log | change mgmt | SIEM | 12 months | write-once |

Storage requirements:

1. **Write-once** — log records cannot be modified after write
2. **Tamper-evident** — daily hash chain or signature
3. **Centralized** — all logs flow to a single SIEM
4. **Time-synced** — NTP-disciplined; < 1s drift
5. **Real-time alerting** — SIEM rules for anomalies

The overlay enforces that no application code can write to the audit
log store directly — only the audit-log service can.
