/**
 * digest-git doctor check tests (Phase C, plan Subphase 1.6 — G5).
 *
 * Covers the full outcome ladder from the module docblock:
 *   degraded contract → no store → no stamp → scope mismatch →
 *   stamp≠content (error) → stamp==content + git dirty (warning) →
 *   stamp==content + git clean/unavailable (ok) → throwing contract
 *   (renders a warning, never crashes the doctor).
 *
 * The B contract is injected via `setContractForTests` (fixture rule —
 * no waiting for B's internals). Store fixtures are REAL SQLite files
 * created through `openStoreDb` (no mocks — driver-behavior tests).
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { checkDigestGitSection } from "../../../src/doctor/checks/digest-git.js";
import {
	resetContractForTests,
	setContractForTests,
	type DigestApi,
	type StoreDigestStamp,
} from "../../../src/doctor/contract.js";
import { buildStoreDbPath } from "../../../src/core/paths.js";
import { closeStoreDb, openStoreDb } from "../../../src/io/db.js";

const PROJECT = "DigestApp";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "velpari-digest-git-"));
});

afterEach(() => {
	resetContractForTests();
	rmSync(tmpDir, { recursive: true, force: true });
});

/** Create the store DB (real file, migrated to the current schema). */
function makeStore(): string {
	const dbPath = buildStoreDbPath(PROJECT, tmpDir);
	const db = openStoreDb(dbPath);
	closeStoreDb(db);
	return dbPath;
}

/** Contract fake: stamped == computed by default; override per case. */
function fakeDigest(overrides: Partial<DigestApi> = {}): DigestApi {
	return {
		scope: "store-content-v1",
		computeStoreContentDigest: () => "computed-digest",
		readStoreDigestStamp: (): StoreDigestStamp => ({
			scope: "store-content-v1",
			digest: "computed-digest",
			stampedAt: "2026-09-28T00:00:00.000Z",
		}),
		inspectStoreVersion: () => null,
		...overrides,
	};
}

/** git init + initial commit containing the current tree (fail-hard). */
function gitCommitAll(message: string): void {
	/**
	 * Run one git command in the fixture repo; throws on spawn error or non-zero exit.
	 * @param {string[]} args - Arguments after `git` (e.g. `["init", "-q"]`).
	 * @returns {void} Nothing; success is silent, failure throws.
	 */
	const run = (args: string[]): void => {
		const r = spawnSync("git", args, { cwd: tmpDir, encoding: "utf8" });
		if (r.error) throw r.error;
		if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
	};
	run(["init", "-q"]);
	run(["add", "-A"]);
	run(["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-q", "-m", message]);
}

/**
 * Find the first diagnostic item whose message contains the given text.
 * @param {string} messagePart - Substring to search for in `item.message`.
 * @returns {{ message: string } | undefined} The first matching item, or `undefined` when none match.
 */
function findItem(messagePart: string) {
	return (section: { items: { message: string }[] }): { message: string } | undefined =>
		section.items.find((i) => i.message.includes(messagePart));
}

describe("checkDigestGitSection", () => {
	it("no project configured → info, skipped", () => {
		const section = checkDigestGitSection(tmpDir, "");
		assert.equal(section.title, "Store digest vs git (foreign modification, N21 layer 4)");
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]!.message, /No project configured/);
	});

	it("no store DB → info (nothing to compare)", () => {
		const section = checkDigestGitSection(tmpDir, PROJECT);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]!.message, /No store DB yet/);
	});

	it("contract absent → info digest-contract-unavailable (degraded, never blocks)", () => {
		makeStore();
		setContractForTests({ digest: null });
		const section = checkDigestGitSection(tmpDir, PROJECT);
		assert.equal(section.items.length, 1);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]!.message, /digest-contract-unavailable/);
	});

	it("stamp absent → info digest-not-stamped", () => {
		makeStore();
		setContractForTests({ digest: fakeDigest({ readStoreDigestStamp: () => null }) });
		const section = checkDigestGitSection(tmpDir, PROJECT);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]!.message, /digest-not-stamped/);
	});

	it("stamp scope mismatch → info digest-not-stamped (re-stamp at next publish)", () => {
		makeStore();
		setContractForTests({
			digest: fakeDigest({
				readStoreDigestStamp: () => ({ scope: "store-content-v0-old", digest: "x", stampedAt: "t" }),
			}),
		});
		const section = checkDigestGitSection(tmpDir, PROJECT);
		assert.equal(section.items[0]?.status, "info");
		assert.match(section.items[0]!.message, /digest-not-stamped/);
	});

	it("stamp ≠ recomputed content → error digest-mismatch with git details", () => {
		makeStore();
		setContractForTests({
			digest: fakeDigest({ computeStoreContentDigest: () => "tampered-content" }),
		});
		const section = checkDigestGitSection(tmpDir, PROJECT);
		const err = section.items.find((i) => i.status === "error");
		assert.ok(err, "expected an error item");
		assert.match(err!.message, /digest-mismatch/);
		assert.match(err!.message, /foreign modification or an un-stamped velpari writer/);
		assert.ok(err!.details?.some((d) => d.startsWith("stamped:")), "stamp detail expected");
		assert.ok(err!.details?.some((d) => d.startsWith("computed:")), "computed detail expected");
	});

	it("stamp == content, git unavailable (non-repo) → ok", () => {
		makeStore();
		setContractForTests({ digest: fakeDigest() });
		const section = checkDigestGitSection(tmpDir, PROJECT);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]!.message, /git unavailable/);
	});

	it("stamp == content, store committed then file edited → warning store-uncommitted", () => {
		const dbPath = makeStore();
		gitCommitAll("store baseline");
		setContractForTests({ digest: fakeDigest() });
		appendFileSync(dbPath, "\0"); // foreign byte edit outside the publish flow
		const section = checkDigestGitSection(tmpDir, PROJECT);
		const warn = section.items.find((i) => i.status === "warning");
		assert.ok(warn, "expected a warning item");
		assert.match(warn!.message, /store-uncommitted/);
		assert.ok(warn!.details?.some((d) => d.startsWith("git status:")));
	});

	it("stamp == content, repo clean → ok", () => {
		makeStore();
		gitCommitAll("store baseline");
		setContractForTests({ digest: fakeDigest() });
		const section = checkDigestGitSection(tmpDir, PROJECT);
		assert.equal(section.items[0]?.status, "ok");
		assert.match(section.items[0]!.message, /git clean/);
	});

	it("throwing contract → renders a warning, never crashes (doctor always renders)", () => {
		makeStore();
		setContractForTests({
			digest: fakeDigest({
				readStoreDigestStamp: () => {
					throw new Error("boom");
				},
			}),
		});
		const section = checkDigestGitSection(tmpDir, PROJECT);
		assert.equal(section.items[0]?.status, "warning");
		assert.match(section.items[0]!.message, /digest check skipped \(boom\)/);
	});

	it("degraded info never blocks the report verdict (info ≠ error)", () => {
		makeStore();
		setContractForTests({ digest: null });
		const section = checkDigestGitSection(tmpDir, PROJECT);
		assert.ok(section.items.every((i) => i.status === "info"));
	});

	it("uses the repo-relative store path in git probes", () => {
		const dbPath = makeStore();
		const rel = relative(tmpDir, dbPath).split("\\").join("/");
		assert.equal(rel, `Doc/store/${PROJECT}/index.db`);
	});
});
