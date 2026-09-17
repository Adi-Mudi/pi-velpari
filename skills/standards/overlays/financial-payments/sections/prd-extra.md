# financial-payments PRD extra sections

These headings are appended to the standard PRD template when the
`financial-payments` overlay is active. Each section is required by the
overlay's doctor gate.

## Cardholder Data Environment Scope

The PCI-DSS scope declaration. Every system is classified as one of:

- **CDE** — stores, processes, or transmits cardholder data
- **Connected-to** — connects to a CDE system (may or may not be in
  scope per PCI-DSS §1.4.1)
- **Out-of-scope** — does not store / process / transmit CHD and is
  sufficiently isolated from the CDE

| System ID | System purpose | Scope | Justification |
|---|---|---|---|
| <sys-1> | <purpose> | CDE / Connected-to / Out-of-scope | <why> |
| <sys-2> | <purpose> | CDE / Connected-to / Out-of-scope | <why> |

### Cardholder data elements stored

| Element | Stored? | Encrypted at rest? | Masked when displayed? |
|---|---|---|---|
| PAN | yes / no | yes / no | yes / no |
| Cardholder name | yes / no | yes / no | n/a |
| Expiration date | yes / no | yes / no | n/a |
| Service code | yes / no | yes / no | n/a |

Sensitive authentication data (full track, CVV, PIN) MUST NEVER be
stored after authorization (§3.3.1).

## Audit Logging Requirements

The events that MUST be logged per PCI-DSS §10.

| Event type | Required fields | Retention | Storage |
|---|---|---|---|
| User authentication | user, timestamp, source IP, outcome | ≥ 12 months | write-once |
| CHD access | user, record ID, timestamp, action | ≥ 12 months | write-once |
| Privileged action (admin) | user, action, target, timestamp | ≥ 12 months | write-once |
| Key access | user, key ID, operation, timestamp | ≥ 12 months | write-once |
| Config change | user, change, before/after, timestamp | ≥ 12 months | write-once |
| Audit log access | user, log range, timestamp | ≥ 12 months | write-once |
| Backup / restore | operator, target, timestamp | ≥ 12 months | write-once |

Storage requirements:
- Write-once or signed (no in-place modification)
- ≥ 3 months online, ≥ 12 months total
- Daily integrity check (hashed chain or signed)

## Segregation of Duties

The roles and the conflicts between them per SOX §404 and PCI-DSS §7.

| Role | Privilege | Cannot also hold |
|---|---|---|
| Developer | build, deploy to dev/test | deploy to prod, access CHD in prod |
| Deployer | deploy to prod | develop, access CHD |
| Auditor | read all logs + change history | any modify privilege |
| DBA | database admin | app log access, key custody |
| Security admin | key custody, user admin | access CHD |
| CHD operator | read/write CHD in prod | developer, deployer, auditor |

For each role, the overlay requires:

1. A documented owner (or "shared" with dual-control)
2. A documented backup / succession plan
3. Periodic access review (quarterly minimum)

## PCI Compliance Matrix

The PCI-DSS v4.0 requirements that apply to this product. Pick
`applies / does not apply` per requirement; for each `applies`, name
the implementation.

| PCI-DSS § | Requirement | Applies? | Implementation reference |
|---|---|---|---|
| §1.4 | Network segmentation | yes / no | Design §Network Segmentation |
| §3.5.1 | PAN encryption at rest | yes / no | Design §Encryption Strategy |
| §3.6 | Key management | yes / no | Design §Key Management |
| §4.2 | TLS for CHD in transit | yes / no | Design §Encryption Strategy |
| §7 | Restrict access by need-to-know | yes / no | Design §Access Control Model |
| §8 | Identify and authenticate access | yes / no | Design §Access Control Model |
| §10 | Log and monitor access | yes / no | Design §Audit Log Architecture |
| §11 | Test security regularly | yes / no | Testplan §Penetration Test Plan |

## Key Management Requirements

Every key the system uses must be documented in the Key Management
table (PCI-DSS §3.6).

| Key ID | Purpose | Algorithm | Length | Custodian role | Rotation interval | Storage |
|---|---|---|---|---|---|---|
| K-001 | <purpose> | AES | 256 | <role> | <interval> | HSM / software |
| K-002 | <purpose> | RSA | 2048+ | <role> | <interval> | HSM / software |

Key requirements (PCI-DSS §3.6 / §3.7):

1. Cryptographic key lifecycle documented
2. Key custodians formally acknowledge their responsibilities
3. Keys stored in HSMs (or strong key containers)
4. Cryptographic key changes at end of cryptoperiod
5. Retired keys are securely destroyed
6. Manual cleartext key management operations use split knowledge +
   dual control
