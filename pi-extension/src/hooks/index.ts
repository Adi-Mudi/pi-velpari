/**
 * Lifecycle hooks composer (Phase 0 scaffold).
 *
 * Mirrors Senai's `hooks/` convention. Currently a no-op — the entry
 * point in `src/index.ts` still registers its session_start,
 * session_before_compact, session_shutdown, and resources_discover
 * handlers inline. Phase F will move those handlers into per-event
 * files here:
 *
 *   - session-start.ts    — rehydrate state, clear stale TUI status
 *   - session-shutdown.ts — flush pending atomic writes
 *   - resources-discover.ts — register skill paths (currently inline)
 *   - session-before-compact.ts — run-state summary (currently inline)
 *
 * Importing this file costs nothing today; it exists so the
 * layered-architecture rule from AGENTS.md has a home, and so Phase F
 * is a "fill in the empty files" change rather than a restructure.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerHooks(_pi: ExtensionAPI): void {
	// Intentionally empty in Phase 0. See module docstring for Phase F plan.
}
