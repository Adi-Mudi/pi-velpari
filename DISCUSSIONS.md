# Discussions — Open Points (project root)

**Source-of-truth split (developer ruling, 2026-10-15):**
- **`DISCUSSIONS.db`** (SQLite at project root) = decisions, clarifications, status rulings — appended automatically by every session that ends with a developer decision (`scripts/discussion-log.mjs add`).
- **This document (`DISCUSSIONS.md`)** = **open points ONLY** — never the DB. Each open point carries date, status, and reason.

The DB is committed (source of truth must survive) but is user-removable at any time; deleting it never touches artifacts or the store DB.

---

## Open Points

Format: `OP-n — title` · raised date · status (OPEN / RESOLVED / BLOCKED) · reason.

### OP-1 — Obsidian goal
- **Raised:** 2026-09-28
- **Status:** OPEN
- **Reason:** needs the developer to state the actual goal before any research.

### OP-3 — AeonDave/pi-persona
- **Raised:** 2026-09-28
- **Status:** OPEN
- **Reason:** evaluate after the post-rollout upgrade ships; do not add any dependency now.

### OP-4 — N34: lazy / paginated portfolio reads
- **Raised:** 2026-10-06
- **Status:** OPEN
- **Reason:** deferred post-release; no Phase 4 code change (handoff §6 item 2).

### OP-5 — N24 medium/low findings with no owning phase (N24-02 … N24-11)
- **Raised:** 2026-10-06
- **Status:** OPEN (partially ruled — N24-03/N24-04 fixed in Phase 5, 2026-10-06)
- **Reason:** remaining eight parked; no owning phase assigned.

### OP-6 — design-logging multiplexer-gate test is environment-dependent
- **Raised:** 2026-10-08
- **Status:** OPEN
- **Reason:** possible fix as a separate change: stub multiplexer detection.

### OP-7 — herdr pane-spawning backend
- **Raised:** 2026-10-08
- **Status:** BLOCKED (externally)
- **Reason:** v2.1.0 covers detection only; scout spawning needs the herdr-capable `pi-interactive-subagents` fork (see `Doc/herdr-plugin-strategy.md`).

---

## Change Log (append-only)

| Date | Change | Trigger |
|------|--------|---------|
| 2026-10-15 | Created DDT: `DISCUSSIONS.db` (decisions) + this doc (open points); migrated OP-1/3/4/5/6/7 from the parked open-points doc | Developer mandate — "all discussion should be tracked" |
