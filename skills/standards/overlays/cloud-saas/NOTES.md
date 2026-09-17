# Cloud SaaS — SOC 2 + ISO 27001 + NIST 800-53 + ISO 27017 Research Notes

> Authoring notes for `cloud-saas`. Captures what the overlay enforces,
> why, and the standards it references. Not normative for SOC 2,
> ISO 27001, NIST 800-53, or ISO 27017 — see the official documents for
> authoritative text.

## Trust Services Criteria (TSC) — SOC 2

SOC 2 evaluates a service organization against five TSC categories.
Pick the categories that apply to this product.

| TSC | Category | When applicable |
|---|---|---|
| **Security** | Common criteria (always) | All SOC 2 reports |
| **Availability** | System uptime, performance | Production systems with SLAs |
| **Confidentiality** | Sensitive data protection | Products handling confidential data |
| **Processing Integrity** | Accurate, complete, timely processing | Transaction-processing systems |
| **Privacy** | Personal information handling | Products handling personal data (PII) |

The overlay captures the mapping in the PRD's
`## Trust Services Criteria Mapping` and the controls in
`## SOC 2 Control Inventory`.

## SOC 2 Common Criteria (Security)

The Security category is mandatory. It has 9 series:

| Series | Topic | Example controls |
|---|---|---|
| CC1 | Control environment | Code of conduct, background checks |
| CC2 | Communication & information | Security awareness training |
| CC3 | Risk assessment | Annual risk assessment, risk register |
| CC4 | Monitoring activities | Internal audit, control reviews |
| CC5 | Control activities | Access provisioning, change control |
| CC6 | Logical & physical access | MFA, RBAC, badge access |
| CC7 | System operations | Backup, monitoring, incident response |
| CC8 | Change management | Change advisory board, deployment reviews |
| CC9 | Risk mitigation | Vendor risk, business continuity |

The overlay focuses on CC5–CC8 (the technical controls). The
organizational controls (CC1–CC4, CC9) require human processes that
Velpari does not enforce.

## ISO 27001:2022 Annex A Controls

ISO 27001:2022 has 93 Annex A controls. The overlay picks the ones
that map to the design artifacts:

| Control | Topic | Overlay section |
|---|---|---|
| A.5.1 | Policies | (org, not overlay) |
| A.5.7 | Threat intelligence | (org, not overlay) |
| A.5.15 | Access control | Design §IAM |
| A.5.16 | Identity management | Design §IAM |
| A.5.17 | Authentication info | Design §IAM |
| A.5.18 | Access rights | Design §IAM |
| A.8.2 | Privileged access rights | Design §IAM |
| A.8.3 | Information access restriction | Design §IAM |
| A.8.5 | Secure authentication | Design §IAM |
| A.8.9 | Configuration management | Design §IAM |
| A.8.15 | Logging | Design §Audit Logging |
| A.8.16 | Monitoring activities | Design §Audit Logging |
| A.8.24 | Use of cryptography | Design §Data Encryption |
| A.8.28 | Secure coding | (Senai, not overlay) |
| A.8.32 | Change management | (org, not overlay) |

## NIST SP 800-53 Rev 5

NIST 800-53 has 20 control families. The overlay picks the technical
families that map to design artifacts:

| Family | Topic | Overlay section |
|---|---|---|
| AC (Access Control) | 25 controls | Design §IAM |
| AU (Audit & Accountability) | 16 controls | Design §Audit Logging |
| SC (System & Communications Protection) | 51 controls | Design §Data Encryption |
| SI (System & Information Integrity) | 23 controls | Testplan §Penetration Testing |
| CP (Contingency Planning) | 14 controls | Design §Availability + DR |
| MP (Media Protection) | 8 controls | (deployment, not overlay) |

The overlay does not enforce the full NIST 800-53 catalog — it picks
the controls that Velpari can validate at design time.

## ISO 27017 (cloud-specific) + ISO 27018 (PII in cloud)

ISO 27017 adds 37 cloud-specific controls. The overlay captures:

| Control | Topic |
|---|---|
| CLD.6.3 | Tenancy separation (logical/physical) |
| CLD.8.1 | Customer data segregation |
| CLD.9.5 | Cloud service customer access |
| CLD.12.1 | Shared responsibility documentation |
| CLD.13.1 | Information leakage between tenants |

ISO 27018 adds PII-specific controls:

| Control | Topic |
|---|---|
| PII.1.1 | Consent for PII processing |
| PII.2.1 | PII minimization |
| PII.3.1 | Purpose limitation |
| PII.4.1 | PII retention limits |
| PII.5.1 | PII subject rights |

## Multi-tenancy (ISO 27017 CLD.6.3 + CLD.8.1)

The overlay enforces a documented tenant-isolation strategy per data
store:

| Strategy | Use when | Implementation |
|---|---|---|
| **Row-level security** | Single database, many small tenants | Postgres RLS or equivalent |
| **Schema-per-tenant** | Medium tenants, moderate isolation needs | One schema per tenant in shared DB |
| **Database-per-tenant** | Large tenants, strict isolation | Separate database instance |

The `overlay-design-trust-analyzer` scout flags any customer-data
store without a documented strategy.

## Encryption at rest + transit + in-use

The overlay enforces encryption at THREE states:

| State | Default | Stronger option |
|---|---|---|
| **At rest** | AES-256 | HSM-backed keys |
| **In transit** | TLS 1.3 | mTLS + certificate pinning |
| **In use** | Tokenization | Confidential computing (Intel SGX / AMD SEV / Nitro Enclaves) |

"Encryption in use" is the newest requirement. Most SaaS providers
achieve it through tokenization (replace sensitive values with
opaque tokens before they reach the application). Confidential
computing (running enclaves) is the stronger option.

## RTO / RPO per tier (ISO 27001 A.5.30 + SOC 2 Availability)

| Tier | Definition | RTO target | RPO target |
|---|---|---|---|
| Tier-1 | Critical (revenue-impacting) | 1 hour | 15 minutes |
| Tier-2 | Important (productivity-impacting) | 4 hours | 1 hour |
| Tier-3 | Standard (nice-to-have) | 24 hours | 4 hours |

RTO = Recovery Time Objective (how long can the system be down)
RPO = Recovery Point Objective (how much data can be lost)

## What the overlay does NOT enforce

- Organizational controls (training, HR, governance) — CC1-CC4, CC9
- Physical security (data center) — covered by the CSP, not the customer
- Legal compliance (GDPR, CCPA) — separate `eu-personal-data` overlay
- CSP-specific configurations — covered by `csp-aws` / `csp-azure` /
  `csp-gcp` overlays (future)
- Customer contractual terms — handled outside Velpari

## Standards referenced

- **AICPA TSC 2017 (revised 2022)** — Trust Services Criteria for SOC 2
- **ISO/IEC 27001:2022** — Information security management systems
- **ISO/IEC 27017:2015** — Cloud-specific security controls
- **ISO/IEC 27018:2019** — PII protection in public clouds
- **NIST SP 800-53 Rev 5** — Security and privacy controls

## Future versions

- v1.1 — split into `cloud-saas-aws`, `cloud-saas-azure`, `cloud-saas-gcp`
- v1.2 — add `csp-shared-responsibility` section per CSP
- v2.0 — add `## Customer Penetration Test Plan` (when customers require
  the right to test)
