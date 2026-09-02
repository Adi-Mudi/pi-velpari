# velpari-pseudocode — Stage Prompt

## Source
Read `Doc/design_<projectName>.md` (gate check — refuse to run if missing).

## Task
Translate the design into algorithmic pseudocode per module.

## Output Format

Write the working copy to:
`.IDE_Plans/velpari/runs/<run-id>/pseudocode/pseudocode_<projectName>.md`

The published copy (after `/velpari-approve`) goes to:
`Doc/pseudocode_<projectName>.md`

Structure:
```markdown
# Pseudocode — <projectName>

## Module: <name>

### Function: <function-name>

```pseudo
FUNCTION <name>(inputs):
  preconditions: <list>
  postconditions: <list>

  step 1
  step 2
  ...
  RETURN <output>
```

## Module: <name>
...
```

## Per-Block Requirements

For each function:
- **Signature**: name, inputs (with types), output (with type)
- **Preconditions**: state of the world before the function runs
- **Postconditions**: state of the world after the function returns
- **Step-by-step logic**: numbered steps; control flow as plain text

## Zero-Hallucination Rule (FR-22)
Every function must trace back to a module in the source design document.

## Preview Gate
After writing the working copy, render preview + confirm before publishing.
