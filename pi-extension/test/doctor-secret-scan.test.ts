/**
 * doctor/checks/secrets tests (Phase 5).
 *
 * Locks the contract for the expanded secret scan:
 *   - 7 patterns (AWS, GitHub PAT, OpenAI, Google API, PEM, Bearer, generic key=value)
 *   - 4 locations (Doc/, .pi/agents/, .pi/skills/, .pi/velpari/)
 *   - non-md files in .pi/velpari/ are scanned (json)
 *   - non-md files elsewhere are skipped
 *   - empty scan -> ok
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSecretScan, scanForSecrets } from "../src/discipline/doctor/checks/secrets.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "velpari-secrets-"));
}

test("scanForSecrets detects AWS Access Key", () => {
	const hits = scanForSecrets("AKIAIOSFODNN7EXAMPLE");
	assert.equal(hits.length, 1);
	assert.equal(hits[0]!.pattern, "AWS Access Key");
});

test("scanForSecrets detects GitHub PAT", () => {
	const hits = scanForSecrets("ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
	assert.equal(hits.length, 1);
	assert.equal(hits[0]!.pattern, "GitHub PAT");
});

test("scanForSecrets detects OpenAI API key", () => {
	const hits = scanForSecrets("sk-" + "a".repeat(48));
	assert.equal(hits.length, 1);
	assert.equal(hits[0]!.pattern, "OpenAI API Key");
});

test("scanForSecrets detects Google API key", () => {
	const hits = scanForSecrets("AIzaSyA-abcdefghijklmnopqrstuvwxyz123456");
	assert.equal(hits.length, 1);
	assert.equal(hits[0]!.pattern, "Google API Key");
});

test("scanForSecrets detects PEM private key", () => {
	const hits = scanForSecrets("-----BEGIN RSA PRIVATE KEY-----");
	assert.equal(hits.length, 1);
	assert.equal(hits[0]!.pattern, "PEM private key");
});

test("scanForSecrets detects Bearer token", () => {
	const hits = scanForSecrets("Authorization: Bearer abcdefghijklmnopqrstuv");
	assert.equal(hits.length, 1);
	assert.equal(hits[0]!.pattern, "Bearer token");
});

test("scanForSecrets detects generic key=value secret", () => {
	const hits = scanForSecrets('api_key="abcdefghij1234"');
	assert.equal(hits.length, 1);
	assert.equal(hits[0]!.pattern, "Generic key=value secret");
});

test("scanForSecrets returns empty hits for clean text", () => {
	const hits = scanForSecrets("This is a perfectly clean markdown file with no secrets.");
	assert.equal(hits.length, 0);
});

test("checkSecretScan flags secrets in Doc/ markdown files", () => {
	const dir = tempDir();
	try {
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(
			join(dir, "Doc", "leaky.md"),
			"# Doc\n\nHere is the API key: AKIAIOSFODNN7EXAMPLE\n",
			"utf8",
		);
		const section = checkSecretScan(dir);
		const warn = section.items.find(
			(it) => it.status === "warning" && /Doc\/leaky\.md/.test(it.message),
		);
		assert.ok(warn);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("checkSecretScan flags secrets in .pi/agents/ markdown files", () => {
	const dir = tempDir();
	try {
		mkdirSync(join(dir, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(dir, ".pi", "agents", "leaky.md"),
			"---\nname: leaky\n---\n\nleaked ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa here\n",
			"utf8",
		);
		const section = checkSecretScan(dir);
		const warn = section.items.find(
			(it) => it.status === "warning" && /leaky\.md/.test(it.message),
		);
		assert.ok(warn);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("checkSecretScan flags secrets in .pi/skills/ SKILL.md files", () => {
	const dir = tempDir();
	try {
		mkdirSync(join(dir, ".pi", "skills", "demo"), { recursive: true });
		writeFileSync(
			join(dir, ".pi", "skills", "demo", "SKILL.md"),
			"# Demo\n\nBearer abcdefghijklmnopqrstuv here\n",
			"utf8",
		);
		const section = checkSecretScan(dir);
		const warn = section.items.find(
			(it) => it.status === "warning" && /SKILL\.md/.test(it.message),
		);
		assert.ok(warn);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("checkSecretScan flags secrets in .pi/velpari/ json files", () => {
	const dir = tempDir();
	try {
		mkdirSync(join(dir, ".pi", "velpari"), { recursive: true });
		writeFileSync(
			join(dir, ".pi", "velpari", "leaky.json"),
			'{"api_key": "abcdefghij1234"}',
			"utf8",
		);
		const section = checkSecretScan(dir);
		const warn = section.items.find(
			(it) => it.status === "warning" && /leaky\.json/.test(it.message),
		);
		assert.ok(warn, "expected a warning for the leaky json file");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("checkSecretScan returns ok when no locations exist", () => {
	const dir = tempDir();
	try {
		const section = checkSecretScan(dir);
		const ok = section.items.find((it) => it.status === "ok");
		assert.ok(ok);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("checkSecretScan returns ok when all files are clean", () => {
	const dir = tempDir();
	try {
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "clean.md"), "# Clean\nNo secrets here.\n", "utf8");
		mkdirSync(join(dir, ".pi", "agents"), { recursive: true });
		writeFileSync(join(dir, ".pi", "agents", "clean.md"), "---\nname: clean\n---\nbody\n", "utf8");
		const section = checkSecretScan(dir);
		const ok = section.items.find((it) => it.status === "ok" && /No secrets detected/.test(it.message));
		assert.ok(ok);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("checkSecretScan includes a final summary item with total count", () => {
	const dir = tempDir();
	try {
		mkdirSync(join(dir, "Doc"), { recursive: true });
		writeFileSync(join(dir, "Doc", "a.md"), "AKIAIOSFODNN7EXAMPLE\n", "utf8");
		writeFileSync(join(dir, "Doc", "b.md"), "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n", "utf8");
		const section = checkSecretScan(dir);
		const summary = section.items.find(
			(it) => /Secret scan: \d+ potential secret/.test(it.message),
		);
		assert.ok(summary, "expected a summary item with count");
		assert.equal(summary.status, "warning");
		assert.match(summary.message, /2 potential/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
