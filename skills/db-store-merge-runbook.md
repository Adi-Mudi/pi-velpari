---
name: db-store-merge-runbook
description: Merge-conflict and recovery procedure for the raw-committed store DB — resolve YAML conflicts by hand, rebuild rows with /velpari-backfill <kind> --from-export, verify with /velpari-doctor.
---

# DB Store — Merge-Conflict & Recovery Runbook (G2)

When a git merge refuses on `Doc/store/<project>/index.db` (the `binary`
attribute — "unable to merge binary files"), use this procedure. The store DB
is committed raw (D2), so a merge conflict on it is resolved on the **YAML
side**, then the DB is rebuilt from the YAML — the DB is derived, the YAML is
the reviewable text (RES-1).

> Prevention is automatic: the publish chain runs
> `ensureStoreGitIntegration` (ops/git-attributes.ts) before every commit, so
> your `.gitattributes` carries `Doc/store/**/index.db binary` and your
> `.gitignore` excludes `index.db-wal` / `index.db-shm`. The doctor's
> **Git integration** section reports any missing pattern; the next publish
> heals it. This runbook is for the day the merge still happens.

## 1. Symptoms

1. `git merge` stops with `warning: Cannot merge binary files … index.db` / `Automatic merge failed`.
2. `git status` lists `Doc/store/<project>/index.db` as "both modified".
3. Two people (or two machines) published to the same project between pulls.

## 2. Resolution steps (per conflicted project DB)

1. Pick the winning side FIRST — whose publish should survive? (Compare
   `git log --oneline ours…theirs -- Doc/store/<project>/` and the teams'
   change logs.) The DB and its YAML of the losing side are discarded as a
   pair; the losing side's work re-publishes from its own branch later.
2. Resolve the YAML conflicts by hand — they are plain text:
   `git checkout --merge` does not apply to binary; instead take the base of
   each YAML file and merge the row differences
   (`Doc/store/<project>/<artifact>_<project>.yaml`). When BOTH sides
   published, keep the higher `version` and the newer `generatedAt` envelope
   fields, then reconcile rows row-by-row (append rows you want to keep from
   the loser; the export format is deterministic — same rows in, same bytes
   out, G5).
3. Rebuild the DB from the resolved YAML, one kind per command:
   `/velpari-backfill <kind> --from-export` — the importer parses the YAML,
   writes + publishes rows, and verifies the checksum (the same chain a
   normal publish runs). Legal kinds: prd, rtm, feasibility, design,
   atomic-functions, pseudocode, testplan, development-order, final-design.
   Order matters when rows cross-reference (run-scoped FKs): prd → rtm;
   atomic-functions → pseudocode, development-order. Import upstream kinds
   first.
4. Verify: `/velpari-doctor` — the **Store DB integrity** section must be ok
   (`PRAGMA quick_check`/`integrity_check`), the **Store DB links** section
   must report no orphans, and every row's checksum must verify (the import
   already refused anything that failed).
5. Commit the resolution as one commit — the rebuilt DB + the resolved YAMLs:
   `git add Doc/store/<project>/ && git commit -m "velpari(store): resolve merge — rebuilt <project> from YAML"`.

## 3. Rebuild-from-YAML procedure (details)

1. Source of truth: the `<artifact>_<project>.yaml` file(s) beside the DB —
   byte-identical to what the publish chain exported (RES-1).
2. `/velpari-backfill <kind> --from-export` reads exactly that file; it never
   writes Doc/ markdown, never advances a stage, never commits (same contract
   as the legacy backfill).
3. The YAML's own `runId` wins on import — cross-kind FKs are run-scoped, so
   a chained rebuild keeps the original run ids and the links stay intact.
4. Missing YAML for a kind? Re-download it from any published version via
   `/velpari-export` (format: yaml), then re-run the import.
5. Checksum honesty (plan R6): the post-import checksum proves YAML↔row
   consistency only — it cannot detect content tampering with the YAML (the
   export carries no fingerprint). The REAL tamper guard is git: YAML is
   text, diffs are reviewable, and this runbook's step 2 is a human decision.

## 4. Prevention notes

1. Publish in one place at a time: two live writers to the same project DB is
   the root cause; the branch model expects one writer per project per run.
2. Pull before you approve: a publish commit carries DB + YAML + published
   docs together — a stale local tree is what turns a clean merge into a
   binary conflict.
3. Never hand-edit `index.db`; the YAML + re-import is the repair path.
4. The `-wal` / `-shm` sidecar files are checkpointed away before every
   publish commit (G1, `wal_checkpoint(TRUNCATE)`) and are gitignored — a
   committed WAL file means the publish chain was bypassed; delete them from
   the index if you find one (`git rm --cached`).

## 5. Optional: readable DB diffs (textconv)

The `binary` attribute disables diffs for the DB (that is the point — merges
are prevented). To still SEE what changed in a commit's YAML, diff the YAML
files (`git diff HEAD~1 -- Doc/store/<project>/*.yaml`). A `sqlite3`-CLI based
textconv (`*.db diff=sqlite3textconv`) is possible but optional tooling — the
YAML diff is the intended review surface and needs no extra tools.

## 6. Doctor pointers

1. **Git integration** section — missing `.gitattributes`/`.gitignore`
   patterns; auto-heals at the next publish, or fix by hand per this runbook.
2. **Store DB integrity** — restore-from-git guidance on corruption
   (`git checkout <commit> -- Doc/store/`).
3. **Store DB links** — orphan trace edges after a hand-merged rebuild
   (re-import the affected kinds in the § 3 order).
4. **Audit hash chain (N15)** — a broken `audit_ledger`/`tx_log` chain (the
   report names the row): treat it as tampering — the trail can no longer be
   trusted; investigate before rebuilding anything.
5. **Baselines vs revisions (F7)** — a consumer's adopted baseline points at
   a `WITHDRAWN` revision (error: content was pulled) or a superseded
   revision (info: non-head adoption); re-adopt the head revision by
   re-running the consumer stage.
6. **Last verified backup (N11)** — no backup yet (the next publish,
   `/velpari-db-reset` or `/velpari-migrate-store` writes one) or the newest
   backup failed verification (restore from git per § 2 or an older snapshot).
7. **Run lock (N13)** — a stale run lock from a crashed session; the ONLY
   sanctioned clear is `/velpari-reset` (confirm + audit event) — never
   hand-delete `.lock/`.
8. **Run worktree (N14)** — a run is bound to a worktree path that no longer
   exists (removed while the run was active): restore the worktree or reset
   the run before continuing.

## 7. Guided merge-back (`/velpari-merge-back`, N12)

The hand-driven procedure above also has one deliberate command surface
(Phase 6). **Never automatic (G-4):** the command plans first; only
`--execute` **plus** one confirmation prompt runs anything.

1. **Dry-run (default):** `/velpari-merge-back <branch>` prints the
   read-only plan — branch/merge-base, file overlap (and any `Doc/store/`
   overlap), the `git merge-tree` conflict preview, current doctor counts,
   stale consumers, and the 5 planned steps. It writes nothing.
2. **`--execute`** runs the fixed N12 chain after the confirmation:
   1. `git merge --no-ff <branch>` — a conflict **stops here** (steps 2–5
      skipped, no audit rows, no auto-abort): resolve per §2/§3 or
      `git merge --abort`, then **re-run the same command** — the
      already-merged path finishes steps 2–5 only.
   2. Store verification — every published artifact re-checksums from its
      rows; a mismatch names the kind ⇒ hand-merge damage ⇒ rebuild per §3.
   3. Doctor audit (embedded — writes nothing).
   4. Staleness recompute.
   5. Downstream consumers flagged stale per F14.
3. **Audit trail:** each step appends one row per project store to
   `audit_ledger` (`actor=velpari-merge-back`, `action=merge-back`,
   reason `step <N>: <title>`, detail `{step, branch, status, message, …}`),
   then the store DB is committed
   explicitly as `velpari(merge-back): <branch> — audit trail` — never
   bundled into the merge commit. A conflicted run writes nothing (step 1
   stops first).
4. Re-running on an already-merged branch is safe (idempotent — steps 2–5
   re-verify and re-stamp the trail).
