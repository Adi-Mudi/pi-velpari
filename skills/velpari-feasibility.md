# velpari-feasibility — Stage Prompt

## Source
Read `Doc/RTM_<projectName>.md` (gate check — refuse to run if missing).

## Task
Analyze feasibility across five dimensions and produce a Go / Conditional Go / No-Go verdict.

## Output Format

Write the working copy to:
`.IDE_Plans/velpari/runs/<run-id>/feasibility/feasibility-study_<projectName>.md`

The published copy (after `/velpari-approve`) goes to:
`Doc/feasibility-study_<projectName>.md`

Structure:
```markdown
# Feasibility Study — <projectName>

## 1. Technical Feasibility
- Stack fit, ecosystem maturity, technical risks
- Rating: Go / Conditional Go / No-Go

## 2. Economic Feasibility
- Build cost, ongoing cost, expected ROI
- Rating: Go / Conditional Go / No-Go

## 3. Legal Feasibility
- Compliance, IP, licensing, regulatory
- Rating: Go / Conditional Go / No-Go

## 4. Operational Feasibility
- Deployment, support, monitoring, on-call
- Rating: Go / Conditional Go / No-Go

## 5. Schedule Feasibility
- Milestones, dependencies, critical path
- Rating: Go / Conditional Go / No-Go

## 6. Overall Verdict
<one paragraph summary + final Go / Conditional Go / No-Go>

## 7. Conditions (if Conditional Go)
<numbered list of must-meet conditions for the verdict to flip to Go>

## 8. Risks (top 5)
<numbered list with mitigation>

## 9. Open Questions
<numbered list, to be resolved before implementation begins>
```

## Zero-Hallucination Rule (FR-22)
Every rating must trace back to a statement in the source RTM. If the RTM is silent on a dimension, mark it "Insufficient data — collect more before rating."

## Preview Gate
After writing the working copy, render preview + confirm before publishing.
