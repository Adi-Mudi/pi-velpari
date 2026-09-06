/**
 * io/atomic-write.ts tests (Phase 2).
 *
 * Locks the contract: write succeeds, content matches, parent dirs
 * are created, no `.tmp-*` leftovers after a successful write.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteFile, atomicWriteJson } from "../src/io/atomic-write.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-atomic-"));
}

test("atomicWriteFile writes content to the requested path", () => {
	const dir = tempDir();
	try {
		const path = join(dir, "out.txt");
		atomicWriteFile(path, "hello world", "utf8");
		assert.equal(readFileSync(path, "utf8"), "hello world");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("atomicWriteFile creates missing parent directories", () => {
	const dir = tempDir();
	try {
		const path = join(dir, "nested", "deeper", "out.txt");
		atomicWriteFile(path, "x", "utf8");
		assert.equal(readFileSync(path, "utf8"), "x");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("atomicWriteFile overwrites an existing file", () => {
	const dir = tempDir();
	try {
		const path = join(dir, "out.txt");
		writeFileSync(path, "old", "utf8");
		atomicWriteFile(path, "new", "utf8");
		assert.equal(readFileSync(path, "utf8"), "new");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("atomicWriteFile leaves no `.tmp-*` leftovers on success", () => {
	const dir = tempDir();
	try {
		atomicWriteFile(join(dir, "out.txt"), "x", "utf8");
		const entries = readdirSync(dir);
		const leftovers = entries.filter((e) => e.startsWith(".tmp-"));
		assert.deepEqual(leftovers, [], `Unexpected temp leftovers: ${leftovers.join(", ")}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("atomicWriteFile leaves no `.tmp-*` leftovers after a second write", () => {
	const dir = tempDir();
	try {
		const path = join(dir, "out.txt");
		atomicWriteFile(path, "one", "utf8");
		atomicWriteFile(path, "two", "utf8");
		assert.equal(readFileSync(path, "utf8"), "two");
		const leftovers = readdirSync(dir).filter((e) => e.startsWith(".tmp-"));
		assert.deepEqual(leftovers, []);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("atomicWriteJson writes pretty-printed JSON", () => {
	const dir = tempDir();
	try {
		const path = join(dir, "out.json");
		atomicWriteJson(path, { a: 1, b: ["x", "y"] });
		const raw = readFileSync(path, "utf8");
		assert.match(raw, /\n/);
		assert.match(raw, /"a": 1/);
		assert.match(raw, /"b":\s*\[\s*"x"/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("atomicWriteJson creates parent directories for JSON output", () => {
	const dir = tempDir();
	try {
		const path = join(dir, "nested", "out.json");
		atomicWriteJson(path, { ok: true });
		assert.ok(existsSync(path));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("atomicWriteFile accepts Buffer payloads", () => {
	const dir = tempDir();
	try {
		const path = join(dir, "out.bin");
		const buf = Buffer.from([1, 2, 3, 4]);
		atomicWriteFile(path, buf);
		const raw = readFileSync(path);
		assert.equal(raw[0], 1);
		assert.equal(raw[3], 4);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("atomicWriteFile overwrites a pre-existing directory's file correctly", () => {
	const dir = tempDir();
	try {
		mkdirSync(join(dir, "sub"), { recursive: true });
		const path = join(dir, "sub", "out.txt");
		atomicWriteFile(path, "first");
		atomicWriteFile(path, "second");
		assert.equal(readFileSync(path, "utf8"), "second");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
