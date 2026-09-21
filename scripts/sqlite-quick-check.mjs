// scripts/sqlite-quick-check.mjs
// CI integrity sweep (G4) — runs PRAGMA quick_check on every store DB
// produced by the unit-test build. Exits 1 on the first corruption found.
// Uses node:sqlite (engines.node >= 22.13.0); no new dependencies.
import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Where unit tests are expected to have produced store DBs.
const CANDIDATE_DIRS = [".tmp", "dist/pi-extension/test"];

function findDbFiles(dir, out = []) {
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) findDbFiles(full, out);
		else if (entry.name.endsWith(".db")) out.push(full);
	}
	return out;
}

const dbs = CANDIDATE_DIRS.flatMap((d) => findDbFiles(d));

if (dbs.length === 0) {
	console.log("sqlite-quick-check: no store DBs found — nothing to check (ok)");
	process.exit(0);
}

let failed = false;
for (const dbPath of dbs) {
	const size = statSync(dbPath).size;
	let db;
	try {
		db = new DatabaseSync(dbPath, { readOnly: true });
		const row = db.prepare("PRAGMA quick_check").get();
		const status = Object.values(row)[0];
		if (status === "ok") {
			console.log(`sqlite-quick-check: OK   ${dbPath} (${size} bytes)`);
		} else {
			console.error(`sqlite-quick-check: FAIL ${dbPath} — ${status}`);
			failed = true;
		}
	} catch (err) {
		// A WAL left behind by a test process is not corruption; quick_check
		// still succeeds read-only. Hard failures mean real corruption.
		console.error(`sqlite-quick-check: ERROR ${dbPath} — ${err?.message ?? err}`);
		failed = true;
	} finally {
		db?.close();
	}
}

process.exit(failed ? 1 : 0);
