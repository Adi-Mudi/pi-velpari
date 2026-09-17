# financial-payments Doctor Checks

Each bullet becomes one rule in `/velpari-doctor`'s overlay section.
The doctor gate runs these checks after the design artifact is written.
Errors block the publish.

- Every FR touching cardholder data declares its CDE scope (in-scope / connected-to / out-of-scope).
- Network segmentation diagram shows the CDE as an isolated zone with controlled conduits.
- Every CHD field at rest uses AES-256 (or stronger); every CHD field in transit uses TLS 1.2+.
- Every key in the Key Management table has rotation frequency, custodian, and HSM-backed storage documented.
- Every privileged action (admin access, key access, audit-log access) appears in the audit log specification.
- Segregation of duties enforced: developer, deployer, and auditor are distinct roles for any change path.
- Penetration test scope covers the CDE + connected-to systems; frequency documented (at least annually + after every significant change).
- Every ADR in `## Architecture Decisions` describing a payment-relevant decision carries a PCI-DSS requirement reference.
