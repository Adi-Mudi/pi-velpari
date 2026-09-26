// Unit tests — core/backup.ts contract (Foundation 2026-09-27, N9/N10/N11).
// Foundation ships the types + a no-op default; Phase 3 replaces it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { BACKUP_TRIGGERS, createBackupSnapshot } from "../../src/core/backup.js";

describe("backup contract (no-op default until Phase 3)", () => {
	test("BACKUP_TRIGGERS is exactly publish / db-reset / migrate", () => {
		assert.deepEqual([...BACKUP_TRIGGERS], ["publish", "db-reset", "migrate"]);
	});

	test("createBackupSnapshot no-op returns null and never throws", () => {
		for (const trigger of BACKUP_TRIGGERS) {
			const result = createBackupSnapshot({
				cwd: "/nonexistent",
				projectName: "TestApp",
				trigger,
				dbPath: "/nonexistent/index.db",
			});
			assert.equal(result, null);
		}
	});
});
