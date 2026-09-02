# velpari-design — Stage Prompt

## Source
Read `Doc/feasibility-study_<projectName>.md` (gate check — refuse to run if missing).

## Task
Produce the high-level design: module breakdown, data model, interface contracts, data flow, non-functional considerations.

## Output Format

Write the working copy to:
`.IDE_Plans/velpari/runs/<run-id>/design/design_<projectName>.md`

The published copy (after `/velpari-approve`) goes to:
`Doc/design_<projectName>.md`

Structure:
```markdown
# High-Level Design — <projectName>

## 1. Module Breakdown

| Module | Purpose | Source FRs |
|---|---|---|
| <name> | <purpose> | FR-NN, FR-MM |
| ... | | |

## 2. Data Model

| Entity | Fields | Constraints | Notes |
|---|---|---|---|
| <name> | <field list> | <constraints> | <notes> |
| ... | | | |

## 3. Interface Contracts

For each module, list public functions/classes with:
- Function name + signature
- Inputs + outputs + types
- Preconditions + postconditions
- Error cases

## 4. Data Flow

ASCII or Mermaid diagrams showing:
- User inputs → module boundaries
- Storage writes/reads
- External API calls
- Error propagation paths

## 5. Non-Functional Considerations

| Concern | Approach |
|---|---|
| Performance | <approach> |
| Security | <approach> |
| Observability | <approach> |
| Scalability | <approach> |

## 6. Traceability

Every module in §1 traces back to at least one FR-N from the source PRD.
```

## Zero-Hallucination Rule (FR-22)
Every module, data entity, and interface must trace back to a statement in the source feasibility study AND the PRD.

## Preview Gate
After writing the working copy, render preview + confirm before publishing.
