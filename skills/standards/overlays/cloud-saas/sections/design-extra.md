# cloud-saas Design extra sections

These headings are appended to the standard design template when the
`cloud-saas` overlay is active.

## Multi-Tenancy Architecture

The tenant isolation strategy per data store.

| Data store | Isolation strategy | Implementation | Verified by |
|---|---|---|---|
| <store-1> | row-level / schema-per-tenant / database-per-tenant | <implementation> | <test> |
| <store-2> | row-level / schema-per-tenant / database-per-tenant | <implementation> | <test> |

### Tenant isolation requirements

1. **No cross-tenant data leakage** — every query filters by tenant ID
2. **No cross-tenant key sharing** — each tenant's encryption key is
   isolated (or, for shared keys, the encryption envelope includes
   tenant ID)
3. **No cross-tenant background jobs** — async jobs carry tenant ID
   and respect it
4. **No shared compute contexts** — request handlers create per-tenant
   contexts

### Tenant-specific encryption keys

If the design uses tenant-specific keys (recommended for Restricted
data class):

| Tenant tier | Key strategy | Key rotation |
|---|---|---|
| Tier-1 (large) | dedicated KMS key per tenant | quarterly |
| Tier-2 (medium) | shared KMS key, per-tenant DEK | per-tenant request |
| Tier-3 (small) | shared KMS key, per-tenant DEK | annually |

## Identity and Access Management

The IAM design per ISO 27001 A.5.15 + A.8.2 + SOC 2 CC6.

### Authentication

| Actor | Auth method | MFA? | Re-auth interval |
|---|---|---|---|
| End user (tenant) | password + MFA / SSO | yes | 24 hours |
| Service-to-service | mTLS / OAuth client creds | n/a | per cert rotation |
| Admin (provider) | SSO + MFA + hardware key | yes | 4 hours |
| Privileged admin | SSO + MFA + JIT elevation | yes | per session |

### Authorization

| Model | Use when | Implementation |
|---|---|---|
| **RBAC** | Coarse-grained (admin / user / viewer) | Postgres RLS or app-layer |
| **ABAC** | Fine-grained (time + location + tenant) | Open Policy Agent (OPA) |
| **PBAC** | Resource-scoped (this document, this folder) | ReBAC libs (e.g. OpenFGA) |

### Privileged access

| Control | Implementation |
|---|---|
| Just-in-time elevation | Admin requests access for N hours; auto-revokes |
| Session recording | All admin sessions recorded + reviewed |
| Break-glass procedure | Documented emergency access path with post-incident review |
| Quarterly access review | Manager signs off on every admin |

## Audit Logging

The audit log design per ISO 27001 A.8.15 + NIST AU + SOC 2 CC7.

| Event class | Examples | Log fields | Retention |
|---|---|---|---|
| Authentication | login, logout, MFA challenge | user, timestamp, IP, outcome | 12 months |
| Authorization | access grant, role change | user, target, timestamp | 12 months |
| Data access | record read, export, delete | user, record, tenant, timestamp | 12 months |
| Configuration change | setting change, feature flag | user, change, before/after | 12 months |
| Admin action | user create, key access | user, action, target, timestamp | 12 months |

Storage requirements:

1. **Write-once** — log records cannot be modified after write
2. **Tamper-evident** — daily hash chain or signature
3. **Time-synced** — NTP-disciplined; < 1s drift
4. **Tenant-aware** — log records include tenant ID
5. **Real-time alerting** — SIEM rules for anomalies
6. **Long retention** — ≥ 12 months (often ≥ 7 years for regulated
   industries)

## Data Encryption (Rest + Transit + In-Use)

Encryption at all three states per ISO 27001 A.8.24 + ISO 27017.

### At rest

| Data store | Algorithm | Key length | Key management |
|---|---|---|---|
| <store-1> | AES | 256 | Cloud KMS / HSM |
| <store-2> | AES | 256 | Cloud KMS / HSM |

### In transit

| Communication | Protocol | TLS version | Cert authority |
|---|---|---|---|
| Customer → API | TLS | 1.3 | Public CA |
| Service → service | mTLS | 1.3 | Internal CA |
| Service → database | TLS | 1.3 | Internal CA |

### In use

Two options:

| Option | Implementation | Use when |
|---|---|---|
| **Tokenization** | Replace sensitive values with opaque tokens in app | Most SaaS (default) |
| **Confidential computing** | Run app in CPU enclave (Intel SGX / AMD SEV / Nitro Enclaves) | Highly sensitive data |

For Restricted data class, document the in-use strategy explicitly.

## Availability and Disaster Recovery

The DR design per ISO 27001 A.5.30 + SOC 2 A1 + NIST CP-2.

### Service tier matrix

| Tier | RTO | RPO | Backup frequency | DR test frequency |
|---|---|---|---|---|
| Tier-1 | 1 hour | 15 minutes | continuous (PITR) | quarterly |
| Tier-2 | 4 hours | 1 hour | hourly | semi-annually |
| Tier-3 | 24 hours | 4 hours | daily | annually |

### Backup strategy

| Backup type | Frequency | Retention | Encryption | Storage |
|---|---|---|---|---|
| Full | weekly | 4 weeks | AES-256 | cross-region |
| Incremental | hourly | 7 days | AES-256 | same region |
| Transaction log (PITR) | continuous | 7 days | AES-256 | same region |

### DR strategy

| Tier | DR strategy | Implementation |
|---|---|---|
| Tier-1 | Active-active multi-region | Two regions, traffic manager |
| Tier-2 | Warm standby | Standby region, data replicated async |
| Tier-3 | Cold standby | Backup restored on demand |

### Recovery test

| Test ID | Scenario | Last run | Result | Next run |
|---|---|---|---|---|
| DR-001 | Region failure (Tier-1) | <date> | <pass / fail> | <date> |
| DR-002 | Database restore from backup | <date> | <pass / fail> | <date> |
| DR-003 | Full DR drill (Tier-2) | <date> | <pass / fail> | <date> |
