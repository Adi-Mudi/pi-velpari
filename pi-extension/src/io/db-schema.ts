// ============================================================================
// io/db-schema.ts — v001 DDL (Phase 2: core schema)
// ============================================================================
// Decision record §5 (row-sets), §4.6 (links), §11 (STRICT/FK standards).
// One batch of DDL applied by migration v001 in io/db.ts. All tables STRICT.
//
// Envelope convention: every child table carries `run_id TEXT NOT NULL,
// kind TEXT NOT NULL` + FOREIGN KEY (run_id, kind) REFERENCES
// artifacts(run_id, kind) ON DELETE CASCADE — the parent's composite PK
// supplies the required UNIQUE index.
//
// Column-name deviations from §5 (all yields to the envelope, recorded in
// the Phase 2 plan Risks note 4): `artifact_id` realized by `kind` itself;
// `adr.status` → `adr_status`; `diagram.kind` → `diagram_kind`;
// `test_case.kind` → `tc_kind`. Feasibility vocabulary: the store-level
// feasibility tables use §5's `go/no-go/go-with-conditions`; the verified
// record's `reuse/partial/build` maps at the Phase 4 adapter.
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
	PRIMARY KEY (id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE nfr (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	phase INTEGER NOT NULL CHECK (phase >= 1),
	text_hash TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE prd_section (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	no INTEGER NOT NULL,
	title TEXT NOT NULL,
	body_ref TEXT,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (no),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE rtm_row (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	fr_ref TEXT NOT NULL REFERENCES fr(id) ON DELETE CASCADE,
	af_ref TEXT,
	tc_ref TEXT,
	phase INTEGER NOT NULL CHECK (phase >= 1),
	target_sha256 TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE design_module (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	name TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE module_source_fr (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	module_id TEXT NOT NULL REFERENCES design_module(id) ON DELETE CASCADE,
	fr_id TEXT NOT NULL REFERENCES fr(id) ON DELETE CASCADE,
	PRIMARY KEY (module_id, fr_id),
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
	PRIMARY KEY (id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE diagram (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	diagram_kind TEXT NOT NULL,
	mermaid_text TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE approach (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	module_id TEXT NOT NULL REFERENCES design_module(id) ON DELETE CASCADE,
	tactic_id TEXT NOT NULL,
	PRIMARY KEY (module_id, tactic_id),
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
	PRIMARY KEY (id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE pseudocode_block (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	af_ref TEXT NOT NULL REFERENCES atomic_function(id) ON DELETE CASCADE,
	content_hash TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE test_case (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	tc_kind TEXT NOT NULL CHECK (tc_kind IN ('TC','IT')),
	strategy_ref TEXT,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE tc_trace (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	tc_id TEXT NOT NULL REFERENCES test_case(id) ON DELETE CASCADE,
	target_kind TEXT NOT NULL CHECK (target_kind IN ('fr','nfr','af')),
	target_id TEXT NOT NULL,
	PRIMARY KEY (tc_id, target_kind, target_id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE dev_step (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	id TEXT NOT NULL,
	module TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	PRIMARY KEY (id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE step_af (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	step_id TEXT NOT NULL REFERENCES dev_step(id) ON DELETE CASCADE,
	af_id TEXT NOT NULL REFERENCES atomic_function(id) ON DELETE CASCADE,
	PRIMARY KEY (step_id, af_id),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE step_dep (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	step_id TEXT NOT NULL REFERENCES dev_step(id) ON DELETE CASCADE,
	depends_on_id TEXT NOT NULL REFERENCES dev_step(id) ON DELETE CASCADE,
	PRIMARY KEY (step_id, depends_on_id),
	CHECK (step_id <> depends_on_id),
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
	PRIMARY KEY (no),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE feasibility_decision (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	verdict TEXT NOT NULL CHECK (verdict IN ('go','no-go','go-with-conditions')),
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
	language TEXT PRIMARY KEY,
	passed INTEGER NOT NULL CHECK (passed IN (0,1)),
	result_ref TEXT,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE reuse_scan (
	run_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	candidate TEXT PRIMARY KEY,
	license TEXT,
	repo_freshness TEXT,
	verdict TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
	FOREIGN KEY (run_id, kind) REFERENCES artifacts(run_id, kind) ON DELETE CASCADE
) STRICT;

CREATE TABLE links (
	from_kind TEXT NOT NULL CHECK (from_kind IN ('fr','nfr','rtm','feasibility','design_module','adr','diagram','af','pseudocode','tc','dev_step','final_section')),
	from_id TEXT NOT NULL,
	to_kind TEXT NOT NULL CHECK (to_kind IN ('fr','nfr','rtm','feasibility','design_module','adr','diagram','af','pseudocode','tc','dev_step','final_section')),
	to_id TEXT NOT NULL,
	relation TEXT NOT NULL CHECK (relation IN ('traces','realizes','decomposes','depends_on','covers','calls')),
	PRIMARY KEY (from_kind, from_id, to_kind, to_id, relation)
) STRICT;

CREATE INDEX idx_links_from ON links(from_kind, from_id);
CREATE INDEX idx_links_to ON links(to_kind, to_id);
`;
