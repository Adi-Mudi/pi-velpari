# medical-device-b Doctor Checks

Each bullet becomes one rule in `/velpari-doctor`'s overlay section.
The doctor gate runs these checks after the design artifact is written.
Errors block the publish.

- Every FR has a Software Safety Classification (A / B / C).
- Every risk control measure listed in the design's `## Risk Control Measures` table traces to at least one module or interface.
- Every hazard ID referenced from a module or interface exists in the PRD's `## Risk Management Summary` table.
- Every NFR carries a verification method (Inspection / Test / Analysis).
- Integration test coverage ≥ 95% (covered interfaces / total interfaces).
- System test coverage = 100% (covered FRs / total FRs).
- Risk control verification coverage = 100% (verified controls / total controls).
- The `design-safety-analyzer-report.json` report shows zero error-level findings.
- All SOUP items (if any) carry known-anomaly tests in the testplan.
- Every ADR in `## Architecture Decisions` has at least one hazard reference when the ADRs describe safety-relevant decisions.
