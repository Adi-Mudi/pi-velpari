# velpari-discuss — Stage Prompt

## Mission
The user invokes this stage with `/velpari-discuss <topic>`. The mission string
is everything after the slash command up to the next whitespace or quote.

## Interview Loop (multi-turn)
Ask the user these questions in order, one at a time, via `ctx.ui.input`:

1. **What are you building?** (one sentence summary)
2. **Who is it for?** (intended audience, primary user)
3. **What problem does it solve?** (the pain point)
4. **What is explicitly out of scope?** (anti-goals)
5. **Any constraints?** (tech stack, deadlines, dependencies)
6. **What does success look like?** (acceptance criteria, measurable outcomes)

Continue until the user signals "done" or after question 6, whichever comes first.

## Scout Composition

After the interview, run 3 mandatory scouts and 1 optional scout. Each scout
reads its prompt template from `skills/discuss-subagents/<id>.md` and returns
a `ScoutOutput<T>` proposal envelope.

### Mandatory scouts
1. **NEW EXTRACTOR** — capture each interview answer as a candidate FR-N or
   helper-function update. Output: `{ rawText, classification }[]`
2. **PRD CHECKER** — read existing `Doc/PRD_<projectName>.md` (if present).
   For each new candidate, decide: new FR-N vs update to existing FR-N.
   Output: `{ frId, delta }[]`
3. **RTM CHECKER** — read existing `Doc/RTM_<projectName>.md` (if present).
   For each FR-N touched, list impacted test cases.
   Output: `{ frId, testCase }[]`

### Optional scout (user-prompted)
4. **WEB SEARCH AGENT** — only runs if the user answered "yes" to:
   > "Do you want me to search the web for community resources, official docs,
   > and similar projects related to your input?"

   Output: `{ community, official, similar }[]`

## Decision Agent Logic (deterministic merge)

Per FR-27, after scouts return, classify each candidate input as one of:
- `new-fr` — append to `Doc/PRD_<projectName>.md` as `FR-NN`
- `update-fr` — modify existing `FR-NN` with delta from PRD CHECKER
- `helper-update` — modify existing `HF-NN` in `## Helper Functions`
- `new-helper` — append new `HF-NN` to `## Helper Functions`

Helper-function dedup is by `name + file path` (lowercase, forward-slashes).
Same name in different paths is distinct; same name + same path is the same
helper function (FR-30).

## Output Format

Write the working copy to:
`.IDE_Plans/velpari/runs/<run-id>/discuss/discussion-notes.md`

Structure:
```markdown
# Discussion Notes — <topic>

## Mission
<original mission string>

## Interview Answers
1. Q: ... A: ...
2. ...

## Scout Proposals

### NEW EXTRACTOR
- (FR-NN candidate) <text>
- ...

### PRD CHECKER
- (FR-NN) <delta>
- ...

### RTM CHECKER
- (FR-NN) <test case>
- ...

### WEB SEARCH AGENT (if run)
- community: ...
- official: ...
- similar: ...

## Decision Summary
- new-fr: [...]
- update-fr: [...]
- helper-update: [...]
- new-helper: [...]
```

## Preview Gate
After writing the working copy, render it in the TUI and ask the user to
confirm before publishing. Per FR-23, no Doc/ write without explicit confirmation.
