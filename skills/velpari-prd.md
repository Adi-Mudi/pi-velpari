# velpari-prd — Stage Prompt

## Source
Read `Doc/discussion-<topic-slug>.md` (gate check — refuse to run if missing).

## Task
Convert the discussion notes into a formal Product Requirements Document (PRD).

## Output Format

Write the working copy to:
`.IDE_Plans/velpari/runs/<run-id>/prd/PRD_<projectName>.md`

The published copy (after `/velpari-approve`) goes to:
`Doc/PRD_<projectName>.md`

Structure:
```markdown
# Product Requirements Document — <projectName>

## 1. Objective
<one paragraph summary>

## 2. Background & Context
<why this exists>

## 3. User Personas
<primary, secondary, tertiary users>

## 4. Key Features & Requirements

### 4.1 Functional Requirements

| ID | Requirement |
|---|---|
| FR-01 | <description> |
| FR-02 | <description> |
| ... | |

### 4.2 Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-01 | Determinism | <description> |
| ... | | |

## 5. Constraints
<numbered list>

## 6. Out of Scope
<numbered list>

## 7. Glossary
<terms and definitions>

## 8. Acceptance Criteria
<numbered list, each verifiable>

## 9. Helper Functions

| ID | Name | File Path | Signature | Purpose | FR Deps |
|---|---|---|---|---|---|
| HF-01 | <name> | <path> | <sig> | <purpose> | FR-NN, FR-MM |
| ... | | | | | |
```

## Zero-Hallucination Rule (FR-22)
Every FR-N, NFR-N, and HF-NN entry must trace back to a statement in the
source discussion notes. If the discussion does not mention something, do not
invent it.

## Project-Name Substitution (FR-67, NFR-15)
Read `projectName` from `.pi/velpari/files.json`. Use it in all output paths.
Never hardcode "Pi-Velpari" in any file path.

## Preview Gate
After writing the working copy, render preview + confirm before publishing.
