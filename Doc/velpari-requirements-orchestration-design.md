# Velpari Requirements Orchestration Design

- Status: Confirmed design baseline
- Version: 1.0
- Scope: Requirements factory, PSRS, RTM, profiles, file organization, Doctor checks, and future command integration
- Audience: Product managers, developers, designers, testers, and AI agents using Velpari

## 1. Purpose

Velpari is an orchestration system for turning a product idea into structured development inputs. It must support both human review and AI-agent processing.

The system needs one reliable way to:

- Collect project information.
- Understand the application and domain.
- Select or create a suitable requirements profile.
- Generate a compact Product and Software Requirements Specification (PSRS).
- Keep requirements IDs stable across later stages.
- Generate a separate Requirements Traceability Matrix (RTM).
- Prepare MVP and phase-wise delivery information.
- Support later feasibility, design, pseudocode, test planning, and implementation.

The design keeps documents compact, explicit, testable, and traceable. It does not require the PRD to contain long theoretical explanations.

## 2. Goals

The confirmed goals are:

1. Combine product and software requirements into one compact PSRS document.
2. Keep the existing `/velpari-prd` command for compatibility.
3. Keep RTM as a separate document and separate stage.
4. Use stable requirement IDs across PSRS, RTM, design, pseudocode, and tests.
5. Define MVP at the beginning of the PSRS.
6. Support phase-wise delivery using one consistent document structure.
7. Use a requirements factory with common, application, domain, and development profiles.
8. Ask dynamic and conditional questions instead of using only a fixed interview.
9. Suggest suitable profiles with reasons and require user confirmation.
10. Use web search and web fetch only with user permission and only as research support.
11. Keep working artifacts separate from published documents.
12. Keep Velpari, RTM, and other later commands independently upgradeable.
13. Make Doctor capable of validating the complete requirements system.

## 3. Non-goals

The first implementation should not:

- Generate implementation code from the PSRS directly.
- Invent a profile when no suitable profile exists.
- Turn community research directly into project requirements.
- Merge PSRS and RTM into one document.
- Duplicate PRD logic inside a future `/velpari-prd-rtm` wrapper.
- Require every project to use every domain's sections.
- Add a separate template for every programming language.
- Remove the human review and approval gates.
- Change the current three-path file organization without a later implementation plan.

## 4. Current Velpari flow and current gaps

The current source already has the following major pieces:

- Discussion creates working notes and scout reports.
- PRD uses four scout agents and generates a working-copy PRD.
- RTM uses four scout agents and generates a working-copy RTM.
- Feasibility, design, pseudocode, and testplan use the shared stage runner.
- The commands are registered in `pi-extension/src/commands.ts`.
- The current configuration is stored in `.pi/velpari/files.json`.
- The current working state is stored under `.IDE_Plans/velpari/`.
- Current published documents are written to `Doc/`.

The current gaps are:

- PRD and software requirements do not have a clearly documented combined profile/schema.
- Requirements profiles are not yet a first-class project configuration.
- Published documents are currently written in a mostly flat `Doc/` structure.
- PSRS MVP and phase-wise structure are not yet explicitly defined.
- Doctor does not yet validate requirements profiles, PSRS structure, or PSRS-to-RTM traceability.
- A future command that runs PRD and RTM together does not exist.
- There is no documented compatibility plan for changing the current output paths.

## 5. PSRS: Product and Software Requirements Specification

### 5.1 Definition

The output document is a combined PSRS:

```text
Product requirements
+
Software requirements
```

The existing command remains:

```text
/velpari-prd
```

The output file remains:

```text
PRD_<project>.md
```

The document header should identify the combined nature:

```markdown
# Product and Software Requirements Specification
```

The name `PRD` remains in the file path and command name for compatibility. Internally, the document model is called PSRS.

### 5.2 Why combine them

Velpari has a downstream agent pipeline:

```text
PSRS → RTM → Design → Pseudocode → Test Plan → Implementation
```

A separate PRD and SRS would duplicate information and create two sources of truth. Combining them reduces:

- Duplicate project data.
- Token usage.
- Requirement drift.
- Repeated clarification.
- Cross-file synchronization problems.

The combined document still separates product behavior from detailed software behavior through functional requirements, non-functional requirements, data/interfaces, and acceptance criteria.

## 6. RTM remains separate

RTM has a different purpose from PSRS.

### PSRS purpose

```text
Define what the product and software must do.
```

### RTM purpose

```text
Map each requirement to design, implementation, helper functions, and test cases.
```

Example:

```text
PSRS:
FR-01: A user must be able to add an expense.

RTM:
FR-01 → createExpense() → ExpenseService → TC-01
```

The documents must remain separate because design and test mappings are not requirements. Keeping them separate prevents implementation details from being mistaken for product rules.

## 7. Three output categories

Velpari has three categories of project files.

### 7.1 Configuration

```text
.pi/velpari/
```

Contains project configuration, selected requirements profiles, template selections, and future factory settings.

### 7.2 Temporary working artifacts

```text
.IDE_Plans/velpari/
├── state.json
├── doctor-report.md
└── runs/
    └── <run-id>/
```

Contains working copies, scout reports, temporary analysis, and the active run state.

### 7.3 Published documents

```text
Doc/
```

Contains approved, human-facing final documents after review and approval.

## 8. Published document layout

The current three-path design is retained. `Doc/` is not renamed to `PRD/` because `Doc/` contains many kinds of documents.

```text
Doc/
├── discussion/
│   └── discussion-<topic>.md
│
├── requirements/
│   ├── PRD_<project>.md
│   └── RTM_<project>.md
│
├── feasibility/
│   └── feasibility-study_<project>.md
│
├── design/
│   └── design_<project>.md
│
├── pseudocode/
│   └── pseudocode_<project>.md
│
├── tests/
│   ├── test-plan_<project>.md
│   └── test-cases_<project>.md
│
├── atomic-functions/
│   └── atomic-functions_<project>.md
│
└── development-order/
    └── development-order_<project>.md
```

The `discussion/` subfolder separates discovery documents from implementation requirements. A project may have many discussion topics, so grouping them avoids filename collisions and keeps the requirements folder clean.

## 9. Working document layout

Working copies should mirror the published category structure:

```text
.IDE_Plans/velpari/runs/<run-id>/
├── discuss/
│   └── discussion-notes.md
├── prd/
│   └── PRD_<project>.md
├── rtm/
│   └── RTM_<project>.md
├── feasibility/
│   └── feasibility-study_<project>.md
├── design/
│   └── design_<project>.md
├── pseudocode/
│   └── pseudocode_<project>.md
├── tests/
│   ├── test-plan_<project>.md
│   └── test-cases_<project>.md
└── scouts/
```

Working and published files must never be treated as the same artifact. The working copy is produced first. The published copy is created only after approval.

## 10. Requirements factory

The requirements factory is a profile and rule system. It is not a single giant template that always contains every possible section.

### 10.1 Factory layers

```text
Requirements Factory
│
├── Common Core
│   ├── Objective
│   ├── Problem
│   ├── Users
│   ├── Scope
│   ├── MVP
│   ├── Phases
│   ├── Functional Requirements
│   ├── Non-Functional Requirements
│   ├── Data and Interfaces
│   ├── Errors and Edge Cases
│   ├── Constraints
│   ├── Dependencies and Risks
│   ├── Out of Scope
│   ├── Open Questions
│   ├── Acceptance Criteria
│   ├── Helper Function Candidates
│   └── Traceability Metadata
│
├── Application Profiles
│   ├── Web
│   ├── Mobile
│   ├── Desktop
│   ├── API
│   ├── AI
│   ├── IoT
│   └── Cloud Platform
│
├── Domain Profiles
│   ├── Healthcare
│   ├── Automotive
│   ├── Aerospace
│   ├── Banking
│   ├── Government
│   └── Future Domains
│
├── Development Profiles
│   ├── Agile
│   ├── Waterfall
│   ├── Hybrid
│   ├── Safety Critical
│   └── Regulated
│
└── Output Rules
    ├── Compact PSRS
    ├── Standard PSRS
    ├── Compliance PSRS
    ├── Feature PSRS
    └── Profile-specific output
```

### 10.2 Profile structure

A profile should be a versioned data structure:

```json
{
  "profileId": "banking-web-v1",
  "version": "1.0.0",
  "applicationType": "web",
  "domain": "banking",
  "developmentMethod": "agile",
  "regulated": true,
  "securityLevel": "high",
  "requiredSections": [
    "security",
    "audit",
    "transaction-integrity"
  ],
  "conditionalQuestions": [],
  "validationRules": []
}
```

The project must save the selected profile under `.pi/velpari/`. The profile version must be recorded in the PSRS metadata and validated by Doctor.

## 11. Dynamic profile selection

The proposed configuration command is:

```text
/velpari-configure-requirements
```

This command asks questions, suggests profiles, explains the recommendation, and asks the user to confirm.

### 11.1 Workflow

```text
User starts configuration
        ↓
Ask core project questions
        ↓
Ask conditional domain/platform questions
        ↓
Identify missing information
        ↓
Suggest one or more matching profiles
        ↓
Explain why each profile matches
        ↓
Show the sections each profile adds
        ↓
User confirms or overrides
        ↓
Save profile in .pi/velpari/
        ↓
Run profile validation
        ↓
Doctor reports the selected configuration
```

### 11.2 Core questions

The core question set should be small and dynamic:

1. What is being built?
2. Who uses it?
3. What problem does it solve?
4. Is this a new product, a new feature, or a change to an existing product?
5. What platforms or deployment environments are required?
6. Does it handle sensitive or regulated data?
7. Are external systems or services required?
8. Is there an existing codebase or is this a new system?

### 11.3 Conditional questions

Conditional questions must be selected from the answers.

```text
If banking:
- Does it process money or financial records?
- Are transactions reversible?
- Is an audit history required?
- What user roles can approve a transaction?

If healthcare:
- Does it store patient data?
- Who can access patient records?
- What retention rules apply?
- Is emergency access required?

If AI:
- What data does the model receive?
- What is the minimum accepted accuracy?
- What happens when the model is wrong?
- Is human review required?
```

The factory must not ask every possible question for every project.

## 12. Web search and web fetch rules

The profile-selection process may use web search and web fetch when the user allows it.

Research can help with:

- Similar products.
- Industry terminology.
- Common safety requirements.
- Regulatory references.
- Official platform documentation.
- Community implementation experience.

Research cannot directly become a project requirement.

### Correct use

```text
Community finding:
Banking applications often require audit history.

Velpari asks:
Does this project need an audit history?

User confirms:
Yes, an audit history is required.
```

### Incorrect use

```text
Community finding:
Banking applications need audit history.

Velpari silently creates:
The project must have an audit history.
```

The profile command must record source URLs and research dates when research contributes to a confirmed decision.

## 13. Missing profile behavior

If no suitable profile exists, Velpari must not invent a profile and silently continue.

The user should receive:

```text
No verified profile currently matches this project.

Detected project type:
AI-based medical document system

Suggested action:
Create or install a medical-ai profile before continuing.
```

Available choices:

1. Use the closest available profile.
2. Create a custom profile.
3. Update Velpari with a new profile.
4. Stop.

Doctor should fail validation when a required profile is missing or invalid.

## 14. PSRS document structure

The PSRS should be compact and ordered around the needs of later AI agents.

### 14.1 Metadata

```yaml
documentType: product-software-requirements
version: 1.0.0
status: draft
profile: banking-web-v1
profileVersion: 1.0.0
mission: <mission>
projectName: <project>
```

### 14.2 Core sections

```text
1. Objective
2. Problem
3. System Actors
4. Scope
5. MVP
6. Phases
7. Functional Requirements
8. Non-Functional Requirements
9. Data and Interfaces
10. Errors and Edge Cases
11. Constraints
12. Dependencies and Risks
13. Out of Scope
14. Open Questions
15. Acceptance Criteria
16. Helper Function Candidates
17. Change Log
```

The most important sections for AI agents are the requirement tables, conditions, expected behavior, acceptance criteria, verification method, dependencies, and source references.

## 15. Functional requirements format

Functional requirements define what the system does.

```markdown
## Functional Requirements

| ID | Requirement | Priority | Acceptance | Verification |
|---|---|---|---|---|
| FR-01 | A user can add an expense. | Must | The expense is stored and appears in the monthly report. | Integration test |
| FR-02 | A user can categorize an expense. | Must | The selected category is stored with the expense. | Integration test |
```

A requirement should include conditions and expected behavior when needed:

```yaml
id: FR-03
type: functional
priority: must
statement: The system must calculate the monthly total from the stored expenses belonging to the authenticated user.
condition: The user requests a monthly report.
expectedBehavior: The report includes only expenses belonging to the authenticated user.
acceptance:
  - The total equals the sum of included expenses.
  - Expenses belonging to another user are excluded.
verification:
  - Add expenses for two users.
  - Verify that each user sees only their own total.
source:
  - Discussion answer
```

## 16. Non-functional requirements format

Non-functional requirements define how well the system must perform.

```markdown
## Non-Functional Requirements

| ID | Category | Requirement | Verification |
|---|---|---|---|
| NFR-01 | Performance | The monthly report must load within 2 seconds under the defined test load. | Performance test |
| NFR-02 | Security | An authenticated user must not view another user's expense. | Security test |
| NFR-03 | Reliability | A failed report calculation must not modify stored expenses. | Failure test |
```

AI agents need explicit thresholds and conditions. Vague terms such as "fast", "secure", or "user-friendly" are not sufficient without a testable definition.

## 17. Data and interface requirements

The PSRS may include data and interface requirements when they affect behavior.

```markdown
## Data and Interfaces

| ID | Type | Name | Requirement | Source |
|---|---|---|---|---|
| DATA-01 | Entity | Expense | An expense contains an amount, category, owner, and created timestamp. | FR-01, FR-02 |
| IF-01 | API | Create expense | The create-expense operation requires a valid owner and amount. | FR-01 |
```

Database choice and implementation structure remain design decisions. The PSRS should define the required behavior, constraints, and data meaning, not the final database technology.

## 18. Errors and edge cases

Velpari should explicitly ask for or record important failure behavior.

```markdown
## Errors and Edge Cases

| ID | Condition | Expected Behavior |
|---|---|---|
| ERR-01 | Expense amount is zero or negative | Reject the expense and return a validation error. |
| ERR-02 | Category does not exist | Do not save the expense and return a clear category error. |
| ERR-03 | Monthly report data is unavailable | Show an error state without displaying an incorrect total. |
```

The document should be complete enough that AI agents do not need to guess ordinary failure behavior.

## 19. MVP and phase-wise structure

MVP must be defined near the beginning of the PSRS.

### 19.1 MVP section

```markdown
## MVP

### MVP Goal
Create the smallest useful version of the product.

### MVP Users
Primary users who need the first working release.

### MVP Requirements
- FR-01
- FR-02
- FR-03

### Explicitly Not in MVP
- Bank synchronization
- Shared accounts
- Advanced analytics

### MVP Exit Criteria
- All MVP requirements pass acceptance testing.
- Required security checks pass.
- The primary user workflow is complete.
```

### 19.2 Phase structure

```text
Phase 0: Foundation
Phase 1: MVP
Phase 2: Essential improvements
Phase 3: Advanced features
Phase 4: Scale and optimization
```

Each phase uses the same compact structure:

```markdown
## Phase 1 — MVP

### Goal

### Requirements

### Acceptance Criteria

### Dependencies

### Risks

### Out of Scope
```

The PSRS should use one main document with phase sections. It should not create a completely separate document with different rules for every phase.

Stable requirement IDs should remain stable when a requirement is assigned to a phase.

```text
FR-01 → MVP
FR-02 → MVP
FR-15 → Phase 2
FR-20 → Phase 3
```

## 20. MVP change control

The approved MVP is a versioned baseline.

After implementation, a change should follow this flow:

```text
MVP baseline
        ↓
Change request
        ↓
Impact analysis
        ↓
Requirement version change
        ↓
User approval
        ↓
Updated artifact
```

The system should not silently change an implemented baseline requirement.

A change may be allowed when:

- A requirement was incorrect.
- A safety or compliance issue was discovered.
- The user changes scope.
- A technical limitation makes the original requirement impossible.
- New validated information changes the product.

The change must record:

```text
Changed requirement ID
Previous value
New value
Reason
Affected phases
Affected design items
Affected tests
Approval status
```

## 21. Helper function handling

Helper functions are not ordinary product features. They are implementation-level functions that support one or more requirements.

### 21.1 PSRS treatment

The PSRS may contain helper candidates when the discussion or approved requirements clearly support them.

```markdown
## Helper Function Candidates

| ID | Name | Purpose | Source Requirements | Inputs | Outputs | Errors | Testable |
|---|---|---|---|---|---|---|---|
| HF-01 | validateExpense | Validate expense data before saving. | FR-01, FR-02 | amount, categoryId | validated expense data | invalid amount, missing category | Yes |
| HF-02 | calculateMonthlyTotal | Calculate the total for the authenticated user's expenses. | FR-03 | expense list | monthly total | empty list, unavailable data | Yes |
```

### 21.2 Helper fields

A helper candidate should include:

```text
HF ID
Name
Purpose
Source requirements
Inputs
Outputs
Expected behavior
Error cases
Dependencies
Planned module
Testability
```

Design and pseudocode later confirm the actual function design and implementation path.

### 21.3 Helper relationship

```text
FR-01
  ↓
HF-01
  ↓
Design function
  ↓
Implementation
  ↓
Test case
```

### 21.4 Helper and atomic function rule

```text
Helper function:
May call another helper or an atomic function.

Atomic function:
Must be a leaf node and must not call another atomic function.
```

Velpari should not create a helper for every button, page, or trivial action. It should identify functions with clear inputs, outputs, reusable behavior, and testable error handling.

## 22. Open questions

Open questions are part of a complete requirements document. They should not be hidden or converted into assumptions.

```markdown
## Open Questions

| ID | Question | Impact | Owner | Status |
|---|---|---|---|---|
| Q-01 | Which payment provider must be supported? | Blocks payment integration design. | Product owner | Open |
| Q-02 | Is offline entry required? | Changes data synchronization scope. | Product owner | Open |
```

Doctor should report unresolved high-impact questions. Later stages may continue only when the user confirms how to handle them.

## 23. Wrapper command `/velpari-prd-rtm`

The future command is:

```text
/velpari-prd-rtm
```

It is a wrapper function.

```text
/velpari-prd-rtm
        ↓
calls /velpari-prd
        ↓
calls /velpari-rtm
        ↓
returns both output paths
```

The wrapper must not copy or duplicate PRD and RTM logic.

This separation allows independent upgrades:

```text
Upgrade PRD:
- Change PRD profile.
- Change PRD questions.
- Change PRD schema.
- Change PRD validation.
- Keep RTM mapping changes separate when possible.

Upgrade RTM:
- Change traceability format.
- Change mapping rules.
- Change RTM validation.
- Keep PRD output stable when possible.
```

Initially, the primary commands remain separate:

```text
/velpari-prd
/velpari-rtm
```

The wrapper can be added later after the independent stages are stable and tested.

## 24. Doctor design

Doctor must be upgraded with the requirements system. It should validate both configuration and documents.

### 24.1 Doctor checks

Doctor should check:

1. `.pi/velpari/files.json` is valid.
2. A requirements profile exists when a profile is required.
3. The profile is valid and has a supported version.
4. The profile matches the application type and domain.
5. The selected template structure is available.
6. The PSRS working copy exists and is not empty.
7. The published PSRS exists and is not empty.
8. MVP is defined.
9. Phase information exists.
10. Required sections exist.
11. FR and NFR IDs are unique and valid.
12. Functional requirements have acceptance criteria.
13. Non-functional requirements have verification methods.
14. Placeholder content is not silently accepted.
15. Open questions are reported.
16. The RTM exists when required.
17. RTM references valid PSRS IDs.
18. Helper candidates have valid source requirements.
19. Working and published files are in their correct categories.
20. The selected profile version is recorded in the PSRS.
21. The document status is clear.
22. The output path matches the project name.
23. No generated file contains secrets.

### 24.2 Doctor output

Doctor should report sections such as:

```text
Configuration
Requirements Profile
Template
Published Documents
Working Documents
MVP and Phases
Requirement IDs
Acceptance and Verification
RTM
Helper Traceability
Folder Structure
Open Issues
```

## 25. Compatibility and migration considerations

The current implementation uses mostly flat paths and legacy file names. Any future change to subfolders must be handled as a separate implementation plan.

The implementation plan should decide:

1. Whether to keep the legacy flat paths as compatibility paths.
2. Whether new files use the approved category subfolders immediately.
3. How existing `Doc/PRD_<project>.md` files are reported.
4. How the discussion approval target changes to `Doc/discussion/`.
5. How `buildOutputPath` and `buildDiscussionPath` are upgraded.
6. How `/velpari-approve` maps working files to the correct published subfolder.
7. How Doctor reports both legacy and new paths.
8. How old files are not silently treated as current without a version marker.
9. How the new profile configuration is backed up and versioned.
10. How users can migrate existing project documentation safely.

No path or command change should be implemented as part of this design-document task.

## 26. Future profile extensions

The factory must support future extension without changing the common PSRS model.

New profiles should define:

```text
Profile ID
Profile version
Application type
Domain
Development method
Required sections
Optional sections
Conditional questions
Validation rules
Output adjustments
Compatibility notes
```

Examples of future profiles:

```text
healthcare-ai
banking-mobile
automotive-safety
government-web
aerospace-control
cloud-cost-optimized
offline-first
```

A new profile should not force every project to include unrelated sections.

## 27. Final command and file summary

### Primary commands

```text
/velpari-discuss
/velpari-approve-discuss
/velpari-configure-requirements
/velpari-prd
/velpari-approve
/velpari-rtm
/velpari-feasibility
/velpari-design
/velpari-pseudocode
/velpari-testplan
/velpari-doctor
/velpari-handoff
```

### Future wrapper command

```text
/velpari-prd-rtm
```

### Primary published files

```text
Doc/discussion/discussion-<topic>.md
Doc/requirements/PRD_<project>.md
Doc/requirements/RTM_<project>.md
Doc/feasibility/feasibility-study_<project>.md
Doc/design/design_<project>.md
Doc/pseudocode/pseudocode_<project>.md
Doc/tests/test-plan_<project>.md
Doc/tests/test-cases_<project>.md
Doc/atomic-functions/atomic-functions_<project>.md
Doc/development-order/development-order_<project>.md
```

### Primary working files

```text
.IDE_Plans/velpari/state.json
.IDE_Plans/velpari/doctor-report.md
.IDE_Plans/velpari/runs/<run-id>/discuss/discussion-notes.md
.IDE_Plans/velpari/runs/<run-id>/prd/PRD_<project>.md
.IDE_Plans/velpari/runs/<run-id>/rtm/RTM_<project>.md
```

## 28. Confirmed decisions

The following decisions are confirmed:

- Keep the current three output categories and current three physical paths.
- Use category subfolders inside `Doc/`.
- Do not rename `Doc/` to `PRD/`.
- Keep the file name `PRD_<project>.md` and document type PSRS.
- Keep RTM separate from PSRS.
- Keep `/velpari-prd` and `/velpari-rtm` separate initially.
- Use `/velpari-prd-rtm` later as a wrapper only.
- Add MVP at the beginning of the PSRS.
- Use the same compact structure for each phase.
- Use stable FR, NFR, and HF IDs.
- Record helper candidates in the PSRS and finalize them in design/pseudocode.
- Use common core plus application, domain, and development profiles.
- Ask dynamic and conditional questions.
- Suggest profiles and require user confirmation.
- Use web research only with consent and confirmation.
- Stop when no matching profile exists.
- Upgrade Doctor to validate the complete system.
- Allow future profile and template extensions.

## 29. Open implementation questions

These questions are intentionally left for the implementation plan:

1. Should the new `Doc/` subfolders be used immediately, or should legacy paths remain for one version?
2. Should the selected profile be stored in a new `.pi/velpari/requirements-profile.json` or inside `files.json` first?
3. Which profile library location should ship inside the Velpari package?
4. Should custom profiles be installed from a file, selected from a built-in library, or both?
5. How will web research citations be stored in the project profile and PSRS?
6. Should the PSRS use a single Markdown format with YAML metadata, or Markdown plus a machine-readable JSON sidecar?
7. Which requirement fields are mandatory for every project?
8. How should an unresolved high-impact question block or allow a later stage?
9. What is the exact compatibility policy for existing flat documents?
10. When should the wrapper command be introduced?
11. How should Doctor distinguish legacy documents from versioned new documents?
12. How should generated artifacts be cleaned or archived after a run?

## 30. Implementation boundary

This document records the confirmed design. It does not implement the factory, profile schema, path changes, new commands, PSRS schema changes, RTM changes, or Doctor changes.

The next step should be a separate implementation plan. That plan must contain:

- Exact target files.
- Current content to edit with complete FROM values.
- New files to create.
- Tests to add or update.
- Compatibility handling.
- Build and test commands.
- File deletion rules, if any.
- Scope confirmation before execution.
