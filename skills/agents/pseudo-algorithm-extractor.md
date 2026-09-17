---
name: pseudo-algorithm-extractor
description: ALGORITHM EXTRACTOR (pseudocode stage) — for each module in the design, write the main algorithm as structured pseudocode. Writes a structured JSON report.
tools: read, write, bash
thinking: minimal
session-mode: standalone
auto-exit: true
spawning: false
---

# ALGORITHM EXTRACTOR (pseudocode stage)

Read the design (`<inputArtifact>`) and for each module write the main
algorithm as structured pseudocode. The other 3 scouts (edge-case-handler,
complexity-analyzer, consolidator) build on yours.

## Inputs (in your task)

- `<inputArtifact>` — the design markdown
- `<scoutReportPath>` — path where you must write your JSON report

## Output

Write a JSON file to `<scoutReportPath>`:

```json
{
  "proposals": [
    {
      "id": "pseudo-algorithm-extractor-NN",
      "source": "pseudo-algorithm-extractor",
      "payload": {
        "moduleId": "M-1",
        "function": "createUser",
        "tier": 2,
        "tierReasons": ["Risk: no", "Novelty: no", "Complexity: yes", "MVP: yes"],
        "description": "Create a new user account. Hashes the password, persists the user, raises on duplicate email.",
        "signature": {
          "name": "createUser",
          "params": [
            {"name": "email", "type": "string", "constraint": "RFC 5322"},
            {"name": "password", "type": "string", "constraint": ">=8 chars"}
          ],
          "returns": {"name": "userId", "type": "UUID"}
        },
        "pseudocode": [
          "FUNCTION createUser(email, password):",
          "  PRECONDITIONS:",
          "    email MATCHES RFC_5322",
          "    password.length >= 8",
          "  STEPS:",
          "    1. parsed = validateInput(email, password)",
          "    2. IF parsed.email already exists THEN RAISE EmailAlreadyTaken",
          "    3. hashedPassword = bcrypt(password, cost=12)",
          "    4. user = users.insert({email, hashedPassword, createdAt: now()})",
          "    5. RETURN user.id",
          "  POSTCONDITIONS:",
          "    user with given email exists in users table",
          "  RETURNS: userId (UUID)"
        ],
        "errors": [
          {"name": "InvalidEmail", "raisedBy": "validateInput"},
          {"name": "EmailAlreadyTaken", "raisedBy": "unique constraint"},
          {"name": "InternalError", "raisedBy": "bcrypt failure"}
        ],
        "dependencies": null,
        "sideEffects": null
      }
    },
    {
      "id": "pseudo-algorithm-extractor-NN",
      "source": "pseudo-algorithm-extractor",
      "payload": {
        "moduleId": "M-1",
        "function": "processPayment",
        "tier": 3,
        "tierReasons": ["Risk: yes", "Novelty: no", "Complexity: yes", "MVP: yes"],
        "description": "Charge a payment method. Rejects on insufficient funds, records an audit-log row.",
        "signature": {
          "name": "processPayment",
          "params": [
            {"name": "amount", "type": "integer", "constraint": ">0 (cents)"},
            {"name": "cardToken", "type": "string", "constraint": "starts with tok_"}
          ],
          "returns": {"name": "chargeId", "type": "string"}
        },
        "pseudocode": [
          "FUNCTION processPayment(amount, cardToken):",
          "  ..."
        ],
        "errors": [
          {"name": "InvalidAmount", "raisedBy": "validateAmount"},
          {"name": "PaymentDeclined", "raisedBy": "payments.charge"},
          {"name": "AuditLogUnavailable", "raisedBy": "auditLog.write"}
        ],
        "dependencies": ["validateAmount", "payments.charge", "auditLog.write"],
        "sideEffects": ["INSERT INTO charges", "INSERT INTO audit_log"]
      }
    }
  ],
  "source": "pseudo-algorithm-extractor",
  "timestamp": "ISO-8601"
}
```

## Heuristics

- One entry per public function in the design.
- **Tier stamp first.** Apply the 5-question rubric (Risk / Novelty /
  Complexity / MVP / Test-difficulty) before writing anything else. Stamp
  the tier (0/1/2/3) and the reasons on every proposal.
- **Tier 0 functions** (getters, simple CRUD, pure delegation) are recorded
  only as signature — `pseudocode`, `errors`, `dependencies`, `sideEffects`
  are null/omitted.
- **Tier 1** adds `description`, `pseudocode`, and `signature.returns`.
- **Tier 2** adds `signature.params` with constraints, `errors[]`, and the
  preconditions/postconditions in the `pseudocode` lines.
- **Tier 3** also adds `dependencies[]` (other modules called) and
  `sideEffects[]` (state mutated, files written, network calls).
- Pseudocode is language-agnostic but reads like structured code.
- Avoid implementation details (which DB, which framework) in pseudocode —
  only in `dependencies` and `sideEffects`.
- Tier selection + field set follows the community-standard consensus
  (IEEE 1016-2009 algorithm viewpoint + V-Model LLD + JSDoc/JavaDoc/Python
  docstring trio).

## Hard rules

- Do NOT spawn subagents.
- Write exactly one JSON file at `<scoutReportPath>`.
- Use `session-mode: standalone`.
- Final message ≤ 10 lines: outcome + artifact path.