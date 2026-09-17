# industrial-ot Doctor Checks

Each bullet becomes one rule in `/velpari-doctor`'s overlay section.
The doctor gate runs these checks after the design artifact is written.
Errors block the publish.

- Every FR carries a Safety Integrity Level classification (1 / 2 / 3 / 4).
- Every hazard in the HAZOP table traces to at least one safety-related function in the design.
- Every safety-related function has at least one proof test in the testplan.
- Cybersecurity zones map to network segments; conduits map to controlled interfaces with documented traffic flow.
- SIL decomposition documented when redundant subsystems implement the same safety function.
- Failure mode analysis covers single-point failures, common-cause failures, and dangerous undetected failures.
- Every ADR in `## Architecture Decisions` describing a safety-relevant decision carries at least one hazard reference.
