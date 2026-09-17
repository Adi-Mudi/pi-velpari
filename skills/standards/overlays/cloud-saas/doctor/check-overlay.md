# cloud-saas Doctor Checks

Each bullet becomes one rule in `/velpari-doctor`'s overlay section.
The doctor gate runs these checks after the design artifact is written.
Errors block the publish.

- Every TSC category applicable to the service has at least one control in the design.
- Every customer-data store carries a documented tenant-isolation strategy (row-level security / schema-per-tenant / database-per-tenant).
- Every customer-data field at rest, in transit, AND in use has encryption documented (in-use = confidential computing or tokenization).
- Identity and access management follows least privilege + RBAC; privileged access requires MFA + just-in-time elevation.
- Audit logs cover authentication, authorization, data access, configuration changes, and admin actions.
- RTO and RPO are documented for each service tier (e.g., Tier-1: RTO 1h / RPO 15min).
- Backup strategy documented (frequency, retention, encryption, restore test).
- Every ADR in `## Architecture Decisions` describing a security-relevant decision carries a TSC criterion reference.
