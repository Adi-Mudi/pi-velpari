# cloud-saas PRD extra sections

These headings are appended to the standard PRD template when the
`cloud-saas` overlay is active. Each section is required by the
overlay's doctor gate.

## Trust Services Criteria Mapping

The TSC categories that apply to this service per SOC 2.

| TSC | Applies? | Justification |
|---|---|---|
| Security (Common Criteria) | yes | Always required for SOC 2 |
| Availability | yes / no | <when applicable> |
| Confidentiality | yes / no | <when applicable> |
| Processing Integrity | yes / no | <when applicable> |
| Privacy | yes / no | <when applicable, required if handling PII> |

If a category does not apply, document the reason. Auditor will ask
for justification either way.

## SOC 2 Control Inventory

The SOC 2 controls the design implements. One row per control.

| Control ID | TSC | Description | Implementation reference |
|---|---|---|---|
| CC6.1 | Security | Logical access security software | Design §IAM |
| CC6.2 | Security | New user authorization | Design §IAM |
| CC6.3 | Security | Access removal | Design §IAM |
| CC7.2 | Security | System monitoring | Design §Audit Logging |
| A1.2 | Availability | System availability commitments | PRD §Service Level Commitments |
| C1.1 | Confidentiality | Confidential info identification | PRD §Data Classification |

## Data Classification

The data classes the service handles. Drives encryption + access
requirements.

| Class | Examples | Encryption | Access |
|---|---|---|---|
| Public | Marketing copy, public docs | none | anyone |
| Internal | Employee handbook | none | employees only |
| Confidential | Customer business data | AES-256 at rest, TLS in transit | need-to-know |
| Restricted | PII, payment data, secrets | AES-256 + HSM, TLS 1.3, MFA | explicit grant only |

Every customer-data flow MUST be classified.

## Multi-Tenancy Requirements

The multi-tenancy model and the isolation requirements.

| Requirement | Applies? | Description |
|---|---|---|
| Logical tenant isolation | yes | No tenant can read another tenant's data |
| Tenant-specific encryption keys | yes / no | Each tenant's data encrypted under its own key |
| Tenant-specific database | yes / no | One DB instance per tenant (largest tier only) |
| Cross-tenant background jobs | yes / no | Async jobs respect tenant boundary |
| Tenant-aware audit logs | yes | Audit logs include tenant ID |

## Service Level Commitments

The SLAs the service commits to.

| Metric | Target | Measurement |
|---|---|---|
| Availability (monthly) | 99.9% / 99.95% / 99.99% | External monitor |
| Latency (p95) | < X ms | APM |
| Latency (p99) | < Y ms | APM |
| Error rate | < Z% | APM |
| Incident response (P1) | < 30 min | On-call rotation |
| Recovery time (RTO) | per tier | see Design §Availability |
| Recovery point (RPO) | per tier | see Design §Availability |
