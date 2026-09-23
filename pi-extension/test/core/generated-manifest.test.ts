/**
 * generated-manifest tests (Phase 2).
 *
 * Covers: emptyManifest, loadGeneratedManifest (missing file, corrupt
 * file, wrong shape), saveGeneratedManifest (round-trip), and
 * addToGeneratedManifest (merge semantics + sha256 stability).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	GENERATED_MANIFEST_FILE,
	addToGeneratedManifest,
	emptyManifest,
	getGeneratedManifestPath,
	loadGeneratedManifest,
	saveGeneratedManifest,
	type GeneratedManifest,
} from "../../src/core/generated-manifest.js";

function freshTmp(): string {
	return mkdtempSync(join(tmpdir(), "velpari-manifest-"));
}

describe("generated-manifest (Phase 2)", () => {
	it("emptyManifest returns a valid v1 manifest with empty files", () => {
		const m = emptyManifest();
		assert.equal(m.version, 1);
		assert.deepEqual(m.files, {});
	});

	describe("loadGeneratedManifest", () => {
		it("returns empty manifest when the file does not exist", () => {
			const cwd = freshTmp();
			try {
				const m = loadGeneratedManifest(cwd);
				assert.deepEqual(m, { version: 1, files: {} });
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("returns empty manifest when the file is corrupt JSON", () => {
			const cwd = freshTmp();
			try {
				const dir = join(cwd, ".pi", "velpari");
				mkdirSync(dir, { recursive: true });
				writeFileSync(getGeneratedManifestPath(cwd), "{ not json", "utf8");
				const m = loadGeneratedManifest(cwd);
				assert.deepEqual(m, { version: 1, files: {} });
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("returns empty manifest when version is not 1", () => {
			const cwd = freshTmp();
			try {
				const dir = join(cwd, ".pi", "velpari");
				mkdirSync(dir, { recursive: true });
				writeFileSync(getGeneratedManifestPath(cwd), JSON.stringify({ version: 2, files: {} }), "utf8");
				const m = loadGeneratedManifest(cwd);
				assert.deepEqual(m, { version: 1, files: {} });
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("returns empty manifest when files is not an object", () => {
			const cwd = freshTmp();
			try {
				const dir = join(cwd, ".pi", "velpari");
				mkdirSync(dir, { recursive: true });
				writeFileSync(getGeneratedManifestPath(cwd), JSON.stringify({ version: 1, files: "not an object" }), "utf8");
				const m = loadGeneratedManifest(cwd);
				assert.deepEqual(m, { version: 1, files: {} });
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("returns the persisted manifest when valid", () => {
			const cwd = freshTmp();
			try {
				const dir = join(cwd, ".pi", "velpari");
				mkdirSync(dir, { recursive: true });
				const persisted: GeneratedManifest = {
					version: 1,
					files: { ".pi/agents/foo.md": "deadbeef" },
				};
				writeFileSync(getGeneratedManifestPath(cwd), JSON.stringify(persisted), "utf8");
				const m = loadGeneratedManifest(cwd);
				assert.deepEqual(m, persisted);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	});

	describe("saveGeneratedManifest + loadGeneratedManifest round-trip", () => {
		it("writes + reads back the same manifest", () => {
			const cwd = freshTmp();
			try {
				const manifest: GeneratedManifest = {
					version: 1,
					files: { ".pi/agents/a.md": "abc123", ".pi/agents/b.md": "def456" },
				};
				saveGeneratedManifest(cwd, manifest);
				const loaded = loadGeneratedManifest(cwd);
				assert.deepEqual(loaded, manifest);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("creates the parent directory if missing", () => {
			const cwd = freshTmp();
			try {
				saveGeneratedManifest(cwd, { version: 1, files: { ".pi/agents/x.md": "ff" } });
				assert.ok(
					existsSync(getGeneratedManifestPath(cwd)),
					`manifest file should exist at ${getGeneratedManifestPath(cwd)}`,
				);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	});

	describe("addToGeneratedManifest", () => {
		it("hashes existing files and merges under their project-relative paths", () => {
			const cwd = freshTmp();
			try {
				const agentsDir = join(cwd, ".pi", "agents");
				mkdirSync(agentsDir, { recursive: true });
				const fileA = join(agentsDir, "a.md");
				const fileB = join(agentsDir, "b.md");
				writeFileSync(fileA, "hello", "utf8");
				writeFileSync(fileB, "world", "utf8");

				const merged = addToGeneratedManifest(cwd, [fileA, fileB]);
				assert.equal(merged.version, 1);
				assert.equal(Object.keys(merged.files).length, 2);
				assert.ok(merged.files[".pi/agents/a.md"]);
				assert.ok(merged.files[".pi/agents/b.md"]);
				// sha256 is 64 hex chars
				assert.match(merged.files[".pi/agents/a.md"]!, /^[0-9a-f]{64}$/);

				// On-disk persistence matches in-memory merge
				const loaded = loadGeneratedManifest(cwd);
				assert.deepEqual(loaded, merged);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("MERGES — never wipes pre-existing entries", () => {
			const cwd = freshTmp();
			try {
				// Seed the manifest with an existing entry
				const manifest: GeneratedManifest = {
					version: 1,
					files: { ".pi/agents/existing.md": "pre-existing-sha256" },
				};
				saveGeneratedManifest(cwd, manifest);

				// Add a new file
				const agentsDir = join(cwd, ".pi", "agents");
				mkdirSync(agentsDir, { recursive: true });
				const fileNew = join(agentsDir, "new.md");
				writeFileSync(fileNew, "fresh content", "utf8");

				const merged = addToGeneratedManifest(cwd, [fileNew]);
				assert.equal(merged.files[".pi/agents/existing.md"], "pre-existing-sha256");
				assert.ok(merged.files[".pi/agents/new.md"]);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("re-hashing the same file produces the same sha256 (deterministic)", () => {
			const cwd = freshTmp();
			try {
				const agentsDir = join(cwd, ".pi", "agents");
				mkdirSync(agentsDir, { recursive: true });
				const fileA = join(agentsDir, "stable.md");
				writeFileSync(fileA, "stable content for hashing", "utf8");

				const first = addToGeneratedManifest(cwd, [fileA]);
				const hash1 = first.files[".pi/agents/stable.md"]!;
				// Add again with no other changes
				const second = addToGeneratedManifest(cwd, [fileA]);
				const hash2 = second.files[".pi/agents/stable.md"]!;
				assert.equal(hash1, hash2);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});

		it("skip-unreadable: passes-through unchanged when a file does not exist", () => {
			const cwd = freshTmp();
			try {
				const result = addToGeneratedManifest(cwd, [join(cwd, "nonexistent-file.md")]);
				assert.deepEqual(result, { version: 1, files: {} });
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	});

	it("GENERATED_MANIFEST_FILE is the literal 'generated-manifest.json'", () => {
		assert.equal(GENERATED_MANIFEST_FILE, "generated-manifest.json");
	});
});
