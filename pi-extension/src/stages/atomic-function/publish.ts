/**
 * PHASE 7 — publish phase for /velpari-atomic-function (dedicated layer).
 *
 * **One-command publish (v1.5.0):** atomic-function no longer needs the
 * user to type `the publish tool` after the preview gate. The parent LLM
 * calls `velpari_stage_publish` (registered in `stages/stage-publish-tool.ts`)
 * when the user confirms "yes" at the preview gate. The tool re-uses the
 * same `handleApprove` logic as `the publish tool` (publish gate → atomic
 * publish to `Doc/` → doctor audit → stage advance) so the artifact
 * correctness guarantees are byte-identical to the manual command.
 *
 * This file is the **library helper** that the dedicated layer exposes
 * for callers that want to detect whether atomic-function is currently
 * in a publishable state. It does NOT do publish work itself — the work
 * lives in `ops/approve.ts` (called by the tool and by `the publish tool`).
 *
 * ## Why this is a library, not the runtime
 *
 * Plan B originally planned to MOVE publish into this file (making the
 * stage command fully self-contained). The chosen approach (Option B in
 * the plan) instead ADDS a shared `velpari_stage_publish` tool that all
 * 9 stages call after preview-yes. This keeps:
 *   - the dedicated atomic-function layer (Phases 1-7) as a typed
 *     library of helpers
 *   - the publish logic (single source of truth) in `ops/approve.ts`
 *   - `the publish tool` as a thin manual fallback (delegates to the
 *     same `handleApprove` the tool uses)
 *
 * Layer 1 — imports core/ only.
 */

export const PUBLISH_PHASE_STATUS = "library-helper" as const;

/** Detect when the publish phase for atomic-function has run. The
 *  runtime check is "did `Doc/atomic-functions/<project>.md` appear?"
 *  (handled by the tool + handleApprove); this constant lets callers
 *  declare intent without doing the work themselves. */
export const PUBLISH_DELEGATED_TO = "velpari_stage_publish" as const;