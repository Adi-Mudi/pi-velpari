// ============================================================================
// io/db-schema.ts — v001 DDL (Phase 2: core schema; Phase 4 final amendment)
//              + v002 ADDITIONS (Phase 6: prose columns, decision §14)
// ============================================================================
// Decision record §5 (row-sets), §4.6 (links), §11 (STRICT/FK standards),
// §14 (Phase 6 amendment: 14 prose columns, strict DB-primary reads).
// One batch of DDL applied by migration v001 in io/db.ts. All tables STRICT.
// v002 = forward-only ALTER TABLE … ADD COLUMN additions that promote
// strictly-read stages: slices now need TEXT prose, not just hashes.
//
// Envelope convention: every child table carries `run_id TEXT NOT NULL,
// kind TEXT NOT NULL` + FOREIGN KEY (run_id, kind) REFERENCES
// artifacts(run_id, kind) ON DELETE CASCADE — the parent's composite PK
// supplies the required UNIQUE index.
//
// Per-run natural keys (Phase 4 final amendment, user decision C — the LAST
// v001 amendment; the schema freezes at the first real publish): every
// child table's natural PK is scoped per-run — `PRIMARY KEY (run_id, id)`
// etc. — so two runs may publish the same natural ids without conflict
// (update-mode). Cross-kind FKs are composite same-run references
// (`FOREIGN KEY (run_id, fr_ref) REFERENCES fr(run_id, id)`), which makes
// cross-run references structurally impossible.
//
// Column-name deviations from §5 (all yields to the envelope, recorded in
// the Phase 2 plan Risks note 4): `artifact_id` realized by `kind` itself;
// `adr.status` → `adr_status`; `diagram.kind` → `diagram_kind`;
// `test_case.kind` → `tc_kind`. Feasibility vocabulary: BOTH vocabularies
// are legal in the DDL — §5's `go/no-go/go-with-conditions` AND the
// verified record's `reuse/partial/build` (user decision 2026-09-22: no
// mapping loss, no third vocabulary). The Phase 4 adapter writes the
// verified record's vocabulary verbatim.
// ============================================================================

/** DDL applied by migration v001 (metadata envelope + row-sets + links). */
export const SCHEMA_V001_DDL = `
CREATE TABLE artifacts (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	version INTEGER NOT NULL,
	stage TEXT NOT NULL,
	generated_at TEXT NOT NULL,
	sha256_fingerprint TEXT NOT NULL,
	inputs TEXT NOT NULL DEFAULT '{}',
	reviewer_verdict TEXT,
	change_log TEXT NOT NULL DEFAULT '[]',
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (run_id, kind)
) STRICT;

CREATE TABLE fr (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	phase INTEGER NOT NULL CHECK (phase >= 1),
	text_hash TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (run_id, id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE nfr (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	phase INTEGER NOT NULL CHECK (phase >= 1),
	text_hash TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (run_id, id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE prd_section (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	no INTEGER NOT NULL,
	title TEXT NOT NULL,
	body_ref TEXT,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (run_id, no),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE rtm_row (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	fr_ref TEXT NOT NULL,
	af_ref TEXT,
	tc_ref TEXT,
	phase INTEGER NOT NULL CHECK (phase >= 1),
	target_sha256 TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (run_id, id),
	FOREIGN KEY (run_id, fr_ref) REFERENCES fr(run_id, id) ON DELETE CASCADE,
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE design_module (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	name TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (run_id, id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE module_source_fr (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	module_id TEXT NOT NULL,
	fr_id TEXT NOT NULL,
	PRIMARY KEY (run_id, module_id, fr_id),
	FOREIGN KEY (run_id, module_id) REFERENCES design_module(run_id, id) ON DELETE CASCADE,
	FOREIGN KEY (run_id, fr_id) REFERENCES fr(run_id, id) ON DELETE CASCADE,
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE adr (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	adr_status TEXT NOT NULL CHECK (adr_status IN ('proposed','accepted','superseded','rejected')),
	options TEXT NOT NULL,
	chosen TEXT,
	rationale TEXT,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (run_id, id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE diagram (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	diagram_kind TEXT NOT NULL,
	mermaid_text TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (run_id, id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE approach (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	module_id TEXT NOT NULL,
	tactic_id TEXT NOT NULL,
	PRIMARY KEY (run_id, module_id, tactic_id),
	FOREIGN KEY (run_id, module_id) REFERENCES design_module(run_id, id) ON DELETE CASCADE,
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE atomic_function (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	name TEXT NOT NULL,
	signature TEXT NOT NULL,
	tier TEXT NOT NULL CHECK (tier IN ('entry','basic','intermediate','advanced')),
	criticality TEXT NOT NULL CHECK (criticality IN ('A','B','C')),
	sil TEXT NOT NULL CHECK (sil IN ('none','sil-1','sil-2','sil-3','sil-4')),
	is_leaf INTEGER NOT NULL CHECK (is_leaf IN (0,1)),
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (run_id, id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE pseudocode_block (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	af_ref TEXT NOT NULL,
	content_hash TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (run_id, id),
	FOREIGN KEY (run_id, af_ref) REFERENCES atomic_function(run_id, id) ON DELETE CASCADE,
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE test_case (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	tc_kind TEXT NOT NULL CHECK (tc_kind IN ('TC','IT')),
	strategy_ref TEXT,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (run_id, id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE tc_trace (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	tc_id TEXT NOT NULL,
	target_kind TEXT NOT NULL CHECK (target_kind IN ('fr','nfr','af')),
	target_id TEXT NOT NULL,
	PRIMARY KEY (run_id, tc_id, target_kind, target_id),
	FOREIGN KEY (run_id, tc_id) REFERENCES test_case(run_id, id) ON DELETE CASCADE,
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE dev_step (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	module TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (run_id, id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE step_af (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	step_id TEXT NOT NULL,
	af_id TEXT NOT NULL,
	PRIMARY KEY (run_id, step_id, af_id),
	FOREIGN KEY (run_id, step_id) REFERENCES dev_step(run_id, id) ON DELETE CASCADE,
	FOREIGN KEY (run_id, af_id) REFERENCES atomic_function(run_id, id) ON DELETE CASCADE,
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE step_dep (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	step_id TEXT NOT NULL,
	depends_on_id TEXT NOT NULL,
	PRIMARY KEY (run_id, step_id, depends_on_id),
	CHECK (step_id <> depends_on_id),
	FOREIGN KEY (run_id, step_id) REFERENCES dev_step(run_id, id) ON DELETE CASCADE,
	FOREIGN KEY (run_id, depends_on_id) REFERENCES dev_step(run_id, id) ON DELETE CASCADE,
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE final_section (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	no INTEGER NOT NULL,
	title TEXT NOT NULL,
	source_artifact TEXT NOT NULL,
	source_ids TEXT NOT NULL DEFAULT '[]',
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (run_id, no),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE feasibility_decision (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	verdict TEXT NOT NULL CHECK (verdict IN ('go','no-go','go-with-conditions','reuse','partial','build')),
	language TEXT,
	decided_by TEXT NOT NULL,
	at TEXT NOT NULL,
	web_search_consent INTEGER CHECK (web_search_consent IN (0,1)),
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (run_id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE feasibility_spike (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	language TEXT NOT NULL,
	passed INTEGER NOT NULL CHECK (passed IN (0,1)),
	result_ref TEXT,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (run_id, language),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE reuse_scan (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	candidate TEXT NOT NULL,
	license TEXT,
	repo_freshness TEXT,
	verdict TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (run_id, candidate),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE links (
	run_id TEXT NOT NULL,
	from_kind TEXT NOT NULL CHECK (from_kind IN ('fr','nfr','rtm','feasibility','design_module','adr','diagram','af','pseudocode','tc','dev_step','final_section')),
	from_id TEXT NOT NULL,
	to_kind TEXT NOT NULL CHECK (to_kind IN ('fr','nfr','rtm','feasibility','design_module','adr','diagram','af','pseudocode','tc','dev_step','final_section')),
	to_id TEXT NOT NULL,
	relation TEXT NOT NULL CHECK (relation IN ('traces','realizes','decomposes','depends_on','covers','calls')),
	PRIMARY KEY (run_id, from_kind, from_id, to_kind, to_id, relation)
) STRICT;

CREATE INDEX idx_links_from ON links(run_id, from_kind, from_id);
CREATE INDEX idx_links_to ON links(run_id, to_kind, to_id);
`;

/**
 * v002 prose column additions (Phase 6 amendment, decision §14).
 * Forward-only; ADD COLUMN is supported since SQLite 3.1.3 (no gate).
 * All new columns are TEXT and nullable — existing rows stay valid with
 * NULL prose until re-published or backfilled. `text_hash`/`content_hash`
 * remain authoritative for fingerprint binding (prose is the canonical
 * text behind those hashes; the hashes do NOT change when prose lands).
 *
 * Columns added (14 total):
 *  - fr.text                       (requirement prose for slice reads)
 *  - nfr.text                      (NFR prose)
 *  - prd_section.body              (PRD section prose, body_ref stays)
 *  - pseudocode_block.content      (pseudocode prose, content_hash stays)
 *  - test_case.steps               (REQUIRED for testplan kind; LLM writes prose)
 *  - test_case.objective
 *  - test_case.expected
 *  - design_module.description     (module responsibility prose)
 *  - atomic_function.purpose       (5 of 8 base-core fields, principle 10a)
 *  - atomic_function.source
 *  - atomic_function.cohesion
 *  - atomic_function.verification
 *  - atomic_function.testable
 *  - dev_step.description          (dev-step prose for the DB-rendered doc)
 */
export const SCHEMA_V002_ADDITIONS = `
ALTER TABLE fr ADD COLUMN text TEXT;
ALTER TABLE nfr ADD COLUMN text TEXT;
ALTER TABLE prd_section ADD COLUMN body TEXT;
ALTER TABLE pseudocode_block ADD COLUMN content TEXT;
ALTER TABLE test_case ADD COLUMN steps TEXT;
ALTER TABLE test_case ADD COLUMN objective TEXT;
ALTER TABLE test_case ADD COLUMN expected TEXT;
ALTER TABLE design_module ADD COLUMN description TEXT;
ALTER TABLE atomic_function ADD COLUMN purpose TEXT;
ALTER TABLE atomic_function ADD COLUMN source TEXT;
ALTER TABLE atomic_function ADD COLUMN cohesion TEXT;
ALTER TABLE atomic_function ADD COLUMN verification TEXT;
ALTER TABLE atomic_function ADD COLUMN testable TEXT;
ALTER TABLE dev_step ADD COLUMN description TEXT;
`;
