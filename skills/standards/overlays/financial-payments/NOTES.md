# Financial Payments — PCI-DSS v4.0 + SOX + FFIEC CAT Research Notes

> Authoring notes for `financial-payments`. Captures what the overlay
> enforces, why, and the standards it references. Not normative for
> PCI-DSS, SOX, or FFIEC — see the official documents for authoritative
> text.

## Cardholder Data Environment (CDE) — PCI-DSS v4.0

The CDE is the people, processes, and technology that store, process,
or transmit cardholder data (CHD) or sensitive authentication data
(SAD), plus any system connected to or affecting the security of the
CDE.

| Data element | Stored? | Encrypted? | PCI-DSS requirement |
|---|---|---|---|
| Primary Account Number (PAN) | yes / no | yes / no | §3.5.1 |
| Cardholder name | yes / no | yes / no | §3.5.1 |
| Expiration date | yes / no | yes / no | §3.5.1 |
| Service code | yes / no | yes / no | §3.5.1 |
| Full track data (magnetic stripe) | NEVER after authorization | n/a | §3.3.1 |
| CVV / CVC / CAV2 / CVC2 | NEVER after authorization | n/a | §3.3.1 |
| PIN / PIN block | NEVER after authorization | n/a | §3.3.1 |

The overlay enforces the CDE scope declaration in the PRD (§Cardholder
Data Environment Scope) and the network segmentation in the design
(§Network Segmentation).

## Network segmentation (PCI-DSS §1.4)

PCI-DSS v4.0 §1.4 requires the CDE to be isolated from other networks
through proper network controls. The overlay captures:

| Conduit | From → To | Controls | Justification |
|---|---|---|---|
| <conduit-1> | CDE → corporate | firewall + IDS + MFA | <why> |
| <conduit-2> | CDE → DMZ | firewall + WAF | <why> |

If segmentation is in place, the connected-to systems may still be
in scope (PCI-DSS §1.4.1). Document every connected-to system and
the compensating controls.

## Encryption (PCI-DSS §3.5)

PCI-DSS v4.0 §3.5 requires:

- **Strong cryptography** — AES-128 or higher for symmetric; RSA-2048+
  or ECDSA P-256+ for asymmetric
- **PAN masking** when displayed (§3.5.1) — only first 6 + last 4
  visible
- **PAN unreadability** when stored — render PAN unreadable via
  one-way hash, truncation, index tokens, or strong cryptography
- **Key management** per §3.6 — documented key lifecycle

The overlay enforces AES-256 (or stronger) at rest and TLS 1.2+
in transit.

## Key management (PCI-DSS §3.6 / §3.7)

| Key | Type | Custodian | Rotation interval | Storage |
|---|---|---|---|---|
| KDK | Key encryption key | <role> | <interval> | HSM |
| BDK | Base derivation key | <role> | <interval> | HSM |
| PIN working key | PIN encryption | <role> | <interval> | HSM |

Keys MUST be:

1. Stored in HSMs (PCI-DSS §3.6.3 — hardware security modules)
2. Rotated at the documented interval (overlay default: annually for
   data-encrypting keys, quarterly for session keys)
3. Dual-controlled (no single person can use + rotate the key)
4. Retired securely when no longer needed

## Audit logging (PCI-DSS §10)

Every privileged action MUST be logged. The overlay requires:

| Event type | Log fields | Retention | Alert |
|---|---|---|---|
| Admin login | user, timestamp, source IP, success/fail | ≥ 12 months (3 months online) | on failure |
| Data access to CHD | user, record, timestamp | ≥ 12 months | on bulk access |
| Key access | user, key id, timestamp | ≥ 12 months | always |
| Config change | user, change, before/after | ≥ 12 months | always |
| Audit-log access | user, log range, timestamp | ≥ 12 months | always |

The overlay enforces that the audit log cannot be modified by the
users it logs (write-once storage or signed logs).

## Segregation of duties (SOX §404 + PCI-DSS §7)

| Role | Person (placeholder) | Privileges | Conflicts |
|---|---|---|---|
| Developer | <name> | build, deploy to dev | cannot deploy to prod, cannot access prod data |
| Deployer | <name> | deploy to prod | cannot develop, cannot access CHD |
| Auditor | <name> | read all logs + change history | cannot modify anything |
| DBA | <name> | database admin | cannot access app logs |
| Security admin | <name> | key custody, user admin | cannot view CHD |

The overlay enforces that no single person holds any two conflicting
roles.

## SOX §404 (financial reporting controls)

The overlay does NOT cover the full SOX scope (financial reporting,
disclosure controls). It covers only the IT general controls (ITGC)
that support financial reporting:

- **Change management** — every change is approved, tested, logged
- **Access management** — see Segregation of Duties above
- **Operations** — job scheduling, backup, recovery all logged
- **Backup / recovery** — tested annually

For full SOX coverage, the user must add a separate `sox-financial-reporting`
overlay (future).

## FFIEC CAT (banking cybersecurity)

The FFIEC Cybersecurity Assessment Tool has four domains:

1. **Cyber Risk Management & Oversight** — risk identification, governance
2. **Threat Intelligence & Collaboration** — info sharing, monitoring
3. **Cybersecurity Controls** — preventive + detective controls
4. **External Dependency Management** — third-party + cloud risk

The overlay focuses on **Cybersecurity Controls** (Domain 3). The
other three domains require organizational and process controls that
Velpari does not enforce.

## What the overlay does NOT enforce

- AML / KYC compliance (separate regulatory regime)
- Open banking / PSD2 (EU-specific, separate overlay)
- Card scheme rules (Visa / Mastercard / Amex) — these are contractual
  not regulatory
- State money transmitter licensing (US-state specific)
- PCI Point-to-Point Encryption (P2PE) hardware certification

## Standards referenced

- **PCI-DSS v4.0** (Payment Card Industry Data Security Standard, 2022)
- **SOX §404** (Sarbanes-Oxley Act of 2002, Section 404 — Management
  Assessment of Internal Controls)
- **FFIEC CAT v1.0** (Federal Financial Institutions Examination Council
  Cybersecurity Assessment Tool, 2017)
- **ISO 27001:2022** (Information Security Management Systems)

## Future versions

- v1.1 — add `## P2PE Scope` section for merchants using hardware P2PE
- v1.2 — add `sox-financial-reporting` overlay for full SOX §404
- v2.0 — split into `pci-dss-merchant` and `pci-dss-service-provider`
  (different scope rules)
