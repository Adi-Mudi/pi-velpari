#!/usr/bin/env bash
set -euo pipefail
GITDIR="$(git rev-parse --git-common-dir 2>/dev/null || true)"
if [ -n "$GITDIR" ]; then ROOT="$(cd "$(dirname "$GITDIR")" && pwd)"; else ROOT="$PWD"; fi
exec python3 - "$ROOT" "$@" <<'PYEOF'
import hashlib
import json
import os
import re
import sqlite3
import sys
import datetime
from pathlib import Path

GENESIS = "0" * 64

DDL = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS brainstorm (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('decision','clarification','status')),
  topic TEXT NOT NULL,
  summary TEXT NOT NULL,
  decisions TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),
  lock_reason TEXT,
  supersedes TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('prd','requirement','testplan','testcase','integrationtest','e2etest','edgecase','unittest','trace','discussion_link','checklist')),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','dropped','superseded')),
  version INTEGER NOT NULL DEFAULT 1,
  frozen INTEGER NOT NULL DEFAULT 0 CHECK (frozen IN (0,1)),
  freeze_reason TEXT,
  parent_id TEXT REFERENCES artifacts(id),
  sha256_fingerprint TEXT,
  changed_by TEXT,
  changed_at TEXT,
  reason TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS artifact_revisions (
  id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  content_json TEXT NOT NULL,
  supersedes_revision_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id, revision_number)
) STRICT;
CREATE TABLE IF NOT EXISTS baselines (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  revision_number INTEGER NOT NULL,
  adopted_at TEXT NOT NULL,
  adopted_by TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS traces (
  from_id TEXT NOT NULL REFERENCES artifacts(id),
  to_id TEXT NOT NULL REFERENCES artifacts(id),
  rel TEXT NOT NULL DEFAULT 'covers' CHECK (rel IN ('covers','verifies','traces')),
  PRIMARY KEY (from_id, to_id, rel)
) STRICT;
CREATE TABLE IF NOT EXISTS checklist_runs (
  run_id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES artifacts(id),
  template_revision INTEGER NOT NULL,
  stage TEXT,
  category TEXT,
  input_hashes TEXT,
  run_by TEXT,
  run_at TEXT,
  signoff_by TEXT,
  independence INTEGER NOT NULL DEFAULT 0 CHECK (independence IN (0,1)),
  results_json TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS documents (
  path TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('brainstorm','master','plan','design','report','stream','doc')),
  title TEXT NOT NULL,
  version TEXT,
  status TEXT,
  content_hash TEXT NOT NULL,
  projected_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;
CREATE TABLE IF NOT EXISTS audit_ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  db TEXT NOT NULL CHECK (db IN ('A','B','D')),
  op TEXT NOT NULL,
  row_id TEXT,
  prev_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL,
  at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS _projected_line (
  line_hash TEXT PRIMARY KEY,
  projected_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;
"""


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def open_db(path):
    con = sqlite3.connect(path, isolation_level=None)
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("PRAGMA synchronous=NORMAL")
    con.execute("PRAGMA busy_timeout=5000")
    con.execute("PRAGMA journal_mode=WAL")
    return con


def quick_ok(con):
    try:
        row = con.execute("PRAGMA quick_check").fetchone()
        return bool(row) and row[0] == "ok"
    except sqlite3.DatabaseError:
        return False


def ensure_db(path, ddl):
    p = Path(path)
    rebuilt = not p.exists()
    con = None
    if p.exists():
        try:
            con = open_db(path)
            if not quick_ok(con):
                con.close()
                con = None
        except sqlite3.DatabaseError:
            try:
                con.close()
            except Exception:
                pass
            con = None
        if con is None:
            for suffix in ["", "-wal", "-shm"]:
                q = Path(str(p) + suffix)
                if q.exists():
                    q.unlink()
            rebuilt = True
    if con is None:
        con = open_db(path)
    con.executescript(ddl)
    con.commit()
    return con, rebuilt


def last_hash(con):
    row = con.execute("SELECT entry_hash FROM audit_ledger ORDER BY seq DESC LIMIT 1").fetchone()
    return row[0] if row else GENESIS


def ledger_add(con, db, op, row_id):
    prev = last_hash(con)
    at = now_iso()
    entry = sha256_text(prev + canon({"db": db, "op": op, "row_id": row_id, "at": at}))
    con.execute(
        "INSERT INTO audit_ledger (db, op, row_id, prev_hash, entry_hash, at) VALUES (?, ?, ?, ?, ?, ?)",
        (db, op, row_id, prev, entry, at),
    )


def load_json_obj(content, rel, malformed):
    try:
        obj = json.loads(content)
    except ValueError as e:
        malformed.append(rel + " invalid json: " + str(e))
        return None
    if not isinstance(obj, dict):
        malformed.append(rel + " not a json object")
        return None
    return obj


def read_jsonl(path, malformed, required=()):
    p = Path(path)
    if not p.exists():
        return []
    rows = []
    for lineno, raw in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError as e:
            malformed.append(str(p) + ":" + str(lineno) + " invalid json: " + str(e))
            continue
        if not isinstance(obj, dict):
            malformed.append(str(p) + ":" + str(lineno) + " not a json object")
            continue
        missing = [k for k in required if k not in obj]
        if missing:
            malformed.append(str(p) + ":" + str(lineno) + " missing keys " + ",".join(missing))
            continue
        rows.append((obj, sha256_text(line)))
    return rows


def line_seen(con, line_hash):
    return con.execute("SELECT 1 FROM _projected_line WHERE line_hash=?", (line_hash,)).fetchone() is not None


def line_mark(con, line_hash):
    con.execute("INSERT OR IGNORE INTO _projected_line (line_hash) VALUES (?)", (line_hash,))


def checklist_required():
    return ["schema", "id", "title", "category", "stage", "purpose", "applies_to", "declared_inputs", "version", "status", "owner", "items"]


def validate_templates(root, malformed):
    bad = []
    cl = Path(root) / "docs" / "checklists"
    if cl.exists():
        for f in sorted(cl.glob("*.json")):
            obj = load_json_obj(f.read_text(encoding="utf-8"), str(f), malformed)
            if obj is None:
                continue
            missing = [k for k in checklist_required() if k not in obj]
            if not isinstance(obj.get("items"), list) or not obj.get("items"):
                missing.append("items[]")
            if missing:
                bad.append((str(f), missing))
    return bad


def project_brainstorm(con, root, malformed):
    added = 0
    dups = 0
    in_file = set()
    for d, lh in read_jsonl(Path(root) / ".IDE_Plans" / "brainstorm.jsonl", malformed, ("id", "at", "kind", "topic", "summary")):
        if lh in in_file:
            dups += 1
            continue
        in_file.add(lh)
        if line_seen(con, lh):
            continue
        decisions = canon(d["decisions"]) if d.get("decisions") is not None else None
        cur = con.execute(
            "INSERT OR IGNORE INTO brainstorm (id, at, kind, topic, summary, decisions, version, locked, lock_reason, supersedes) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                d["id"],
                d["at"],
                d["kind"],
                d["topic"],
                d["summary"],
                decisions,
                int(d.get("version", 1)),
                int(d.get("locked", 0)),
                d.get("lock_reason"),
                d.get("supersedes"),
            ),
        )
        if cur.rowcount == 1:
            ledger_add(con, "A", "upsert", d["id"])
            added += 1
        cur = con.execute(
            "UPDATE brainstorm SET locked=?, lock_reason=? WHERE id=? AND (locked IS NOT ? OR lock_reason IS NOT ?)",
            (int(d.get("locked", 0)), d.get("lock_reason"), d["id"], int(d.get("locked", 0)), d.get("lock_reason")),
        )
        if cur.rowcount == 1:
            ledger_add(con, "A", "status", d["id"])
            added += 1
        line_mark(con, lh)
    return added, dups


def iter_b_docs(root, malformed):
    r = Path(root)
    for d, lh in read_jsonl(r / "docs" / "requirements" / "requirements.jsonl", malformed, ("id",)):
        d.setdefault("kind", "requirement")
        yield d, lh
    for sub, kind in [("prd", "prd"), ("tests", None)]:
        base = r / "docs" / sub
        if base.exists():
            for f in sorted(base.rglob("*.json")):
                obj = load_json_obj(f.read_text(encoding="utf-8"), str(f), malformed)
                if obj is None:
                    continue
                if kind and not obj.get("kind"):
                    obj["kind"] = kind
                yield obj, None
    cl = r / "docs" / "checklists"
    if cl.exists():
        for f in sorted(cl.glob("*.json")):
            obj = load_json_obj(f.read_text(encoding="utf-8"), str(f), malformed)
            if obj is None:
                continue
            obj.setdefault("kind", "checklist")
            yield obj, None


def project_artifacts(con, root, malformed):
    added = 0
    dups = 0
    in_file = set()
    for d, lh in iter_b_docs(root, malformed):
        if lh is not None:
            if lh in in_file:
                dups += 1
                continue
            in_file.add(lh)
            if line_seen(con, lh):
                continue
        aid = d["id"]
        kind = d.get("kind", "testcase")
        title = d.get("title") or (d.get("text", "")[:80] or aid)
        status = d.get("status", "draft")
        version = int(d.get("version", 1))
        parent = d.get("parent_id")
        fp = sha256_text(canon(d))
        changed_at = d.get("changed_at") or now_iso()
        cur = con.execute(
            "INSERT OR IGNORE INTO artifacts (id, kind, title, status, version, frozen, parent_id, sha256_fingerprint, changed_by, changed_at, reason) "
            "VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)",
            (aid, kind, title, status, version, parent, fp, d.get("changed_by"), changed_at, d.get("reason")),
        )
        if cur.rowcount == 1:
            ledger_add(con, "B", "artifact", aid)
            added += 1
        cur = con.execute(
            "UPDATE artifacts SET status=?, freeze_reason=? WHERE id=? AND (status IS NOT ? OR freeze_reason IS NOT ?)",
            (status, d.get("freeze_reason"), aid, status, d.get("freeze_reason")),
        )
        if cur.rowcount == 1:
            ledger_add(con, "B", "status", aid)
            added += 1
        rev_id = "REV-" + aid + "-" + str(version)
        cur2 = con.execute(
            "INSERT OR IGNORE INTO artifact_revisions (id, revision_number, artifact_id, content_json, supersedes_revision_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (rev_id, version, aid, canon(d), d.get("supersedes_revision_id"), changed_at),
        )
        if cur2.rowcount == 1:
            ledger_add(con, "B", "revision", rev_id)
            added += 1
        if lh is not None:
            line_mark(con, lh)
    return added, dups


def project_traces(con, root, malformed):
    added = 0
    dups = 0
    in_file = set()
    for t, lh in read_jsonl(Path(root) / "docs" / "trace" / "trace.jsonl", malformed, ("from_id", "to_id")):
        if lh in in_file:
            dups += 1
            continue
        in_file.add(lh)
        if line_seen(con, lh):
            continue
        frm = t["from_id"]
        to = t["to_id"]
        rel = t.get("rel", "covers")
        cur = con.execute("INSERT OR IGNORE INTO traces (from_id, to_id, rel) VALUES (?, ?, ?)", (frm, to, rel))
        if cur.rowcount == 1:
            ledger_add(con, "B", "trace", frm + ">" + to + ":" + rel)
            added += 1
        line_mark(con, lh)
    return added, dups


def head_rev_at(con, artifact_id, at):
    row = con.execute(
        "SELECT revision_number FROM artifact_revisions WHERE artifact_id=? AND created_at<=? ORDER BY revision_number DESC LIMIT 1",
        (artifact_id, at),
    ).fetchone()
    if row:
        return row[0]
    row = con.execute("SELECT version FROM artifacts WHERE id=?", (artifact_id,)).fetchone()
    return row[0] if row else 1


def project_runs(con, root, malformed):
    added = 0
    dups = 0
    in_file = set()
    for run, lh in read_jsonl(Path(root) / "docs" / "checklist_runs.jsonl", malformed, ("run_id", "template")):
        if lh in in_file:
            dups += 1
            continue
        in_file.add(lh)
        if line_seen(con, lh):
            continue
        rid = run["run_id"]
        tmpl = run["template"]
        trev = int(run.get("template_revision", 1))
        ih = canon(run.get("input_hashes", {}))
        cur = con.execute(
            "INSERT OR IGNORE INTO checklist_runs (run_id, template_id, template_revision, stage, category, input_hashes, run_by, run_at, signoff_by, independence, results_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                rid,
                tmpl,
                trev,
                run.get("stage"),
                run.get("category"),
                ih,
                run.get("run_by"),
                run.get("run_at"),
                run.get("signoff_by"),
                int(run.get("independence", 0)),
                canon(run.get("results", [])),
            ),
        )
        if cur.rowcount == 1:
            ledger_add(con, "B", "run", rid)
            added += 1
        run_at = run.get("run_at") or now_iso()
        seen = set()
        for res in run.get("results", []):
            for ev in res.get("evidence", []):
                if ev in seen:
                    continue
                seen.add(ev)
                if con.execute("SELECT 1 FROM artifacts WHERE id=?", (ev,)).fetchone() is None:
                    continue
                cur2 = con.execute("INSERT OR IGNORE INTO traces (from_id, to_id, rel) VALUES (?, ?, 'verifies')", (tmpl, ev))
                if cur2.rowcount == 1:
                    ledger_add(con, "B", "trace", tmpl + ">" + ev + ":verifies")
                    added += 1
                rev = head_rev_at(con, ev, run_at)
                bl = "BL-" + rid + "-" + ev
                cur3 = con.execute(
                    "INSERT OR IGNORE INTO baselines (id, artifact_id, revision_number, adopted_at, adopted_by) VALUES (?, ?, ?, ?, ?)",
                    (bl, ev, rev, run_at, rid),
                )
                if cur3.rowcount == 1:
                    ledger_add(con, "B", "baseline", bl)
                    added += 1
        line_mark(con, lh)
    return added, dups


def iter_doc_files(root):
    r = Path(root)
    ip = r / ".IDE_Plans"
    if ip.exists():
        for pat, kind in [
            ("*_brainstorm_*.json", "brainstorm"),
            ("*_master_*.json", "master"),
            ("*_plan_*.json", "plan"),
            ("*_report_*.json", "report"),
        ]:
            for f in sorted(ip.glob(pat)):
                yield f, kind
        for f in sorted(ip.glob("*.jsonl")):
            yield f, "report"
    dg = r / "design"
    if dg.exists():
        for f in sorted(dg.rglob("*.json")):
            yield f, "design"
    dr = r / "docs"
    if dr.exists():
        for f in sorted(dr.rglob("*")):
            if not f.is_file():
                continue
            if f.suffix == ".json":
                yield f, "doc"
            elif f.suffix == ".jsonl":
                yield f, "stream"


def doc_meta(path, kind, obj):
    title = obj.get("title")
    if not title and isinstance(obj.get("header"), dict):
        title = obj["header"].get("title")
    if not title:
        title = obj.get("initiative") or obj.get("task") or path.stem
    return {
        "kind": kind,
        "title": str(title)[:300],
        "version": None if obj.get("version") is None else str(obj.get("version")),
        "status": None if obj.get("status") is None else str(obj.get("status")),
    }


def project_documents(con, root, malformed):
    added = 0
    ignored = 0
    hash_seen = {}
    dupe_files = 0
    empty_files = 0
    stale = 0
    for f, kind in iter_doc_files(root):
        rel = f.relative_to(root).as_posix()
        content = f.read_text(encoding="utf-8")
        if f.suffix == ".jsonl":
            try:
                obj = json.loads(content)
                if not isinstance(obj, dict):
                    obj = {}
            except ValueError:
                obj = {}
        else:
            obj = load_json_obj(content, rel, malformed)
            if obj is None:
                continue
        meta = doc_meta(f, kind, obj)
        ch = sha256_text(content)
        if not content:
            empty_files += 1
        elif ch in hash_seen:
            dupe_files += 1
        else:
            hash_seen[ch] = rel
        cur = con.execute(
            "INSERT OR IGNORE INTO documents (path, kind, title, version, status, content_hash) VALUES (?, ?, ?, ?, ?, ?)",
            (rel, meta["kind"], meta["title"], meta["version"], meta["status"], ch),
        )
        if cur.rowcount == 1:
            ledger_add(con, "D", "document", rel)
            added += 1
        else:
            ignored += 1
            row = con.execute("SELECT content_hash FROM documents WHERE path=?", (rel,)).fetchone()
            if row and row[0] != ch:
                stale += 1
                cur = con.execute(
                    "UPDATE documents SET content_hash=?, title=?, version=?, projected_at=datetime('now') WHERE path=?",
                    (ch, meta["title"], meta["version"], rel),
                )
                if cur.rowcount == 1:
                    ledger_add(con, "D", "refresh", rel)
                    added += 1
        cur = con.execute(
            "UPDATE documents SET status=? WHERE path=? AND status IS NOT ?",
            (meta["status"], rel, meta["status"]),
        )
        if cur.rowcount == 1:
            ledger_add(con, "D", "status", rel)
            added += 1
    return added, ignored, dupe_files, empty_files, stale


def ref_kind(name):
    for k in ("master", "brainstorm", "plan"):
        if "_" + k + "_" in name:
            return k
    return None


def ref_initiative(name):
    kind = ref_kind(name)
    if kind is None:
        return None
    init = name.rsplit(".", 1)[0].split("_" + kind + "_", 1)[0]
    return re.sub(r"_stage\d+$", "", init)


def initiative_matches(a, b):
    if not a or not b:
        return False
    return a == b or a.startswith(b + "_") or b.startswith(a + "_")


def doc_refs(obj, kinds=("master", "plan", "brainstorm")):
    pat = re.compile(r"([A-Za-z0-9_\-]+_(?:master|plan|brainstorm)_[A-Za-z0-9_.\-]+\.(?:json|md))")
    found = []

    def walk(o):
        if isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
        elif isinstance(o, str):
            for m in pat.findall(o):
                if ref_kind(m) in kinds and m not in found:
                    found.append(m)

    walk(obj)
    return found


def ref_exists(root, name):
    r = Path(root)
    if (r / ".IDE_Plans" / name).exists():
        return True
    return any(r.joinpath(".IDE_Plans").rglob(name))


def doc_rows(con):
    return {row[0]: row for row in con.execute("SELECT path, kind, status, content_hash FROM documents")}


def ensure_store(root):
    store = Path(root) / "store"
    dbstore = Path(root) / "db-store" / "store"
    if store.is_symlink():
        if not store.exists():
            print("error: store symlink is broken (" + str(store) + " -> " + os.readlink(store) + "); single-file invariant: store must be `ln -s db-store/store store`")
            return 1
        return 0
    if store.exists():
        if not store.is_dir():
            print("error: store exists but is not a directory; single-file invariant: store must be `ln -s db-store/store store`")
            return 1
        print("error: store/ exists but is not a symlink; single-file invariant: store must be `ln -s db-store/store store`")
        return 1
    if dbstore.is_dir():
        store.symlink_to(Path("db-store") / "store")
        print("created store symlink -> db-store/store")
        return 0
    store.mkdir(parents=True)
    print("first-run bootstrap: store/ is a plain directory (no db-store worktree yet); create the worktree then replace store/ with `ln -s db-store/store store`")
    return 0


def project(root, malformed):
    if ensure_store(root) != 0:
        return 1
    store = Path(root) / "store"
    con, rebuilt = ensure_db(str(store / "store.db"), DDL)
    con.execute("BEGIN IMMEDIATE")
    try:
        b_rows, b_dups = project_brainstorm(con, root, malformed)
        a_rows, a_dups = project_artifacts(con, root, malformed)
        t_rows, t_dups = project_traces(con, root, malformed)
        r_rows, r_dups = project_runs(con, root, malformed)
        d_rows, d_ignored, d_dupfiles, d_empty, d_stale = project_documents(con, root, malformed)
        con.commit()
    except Exception:
        con.rollback()
        raise
    con.close()
    print("rebuild=" + ("yes" if rebuilt else "no"))
    print("brainstorm added=" + str(b_rows) + " duplicate_lines=" + str(b_dups))
    print("artifacts added=" + str(a_rows) + " duplicate_lines=" + str(a_dups))
    print("traces added=" + str(t_rows) + " duplicate_lines=" + str(t_dups))
    print("checklist_runs added=" + str(r_rows) + " duplicate_lines=" + str(r_dups))
    print("documents added=" + str(d_rows) + " already_present=" + str(d_ignored) + " duplicate_files=" + str(d_dupfiles) + " empty_files=" + str(d_empty) + " stale_content=" + str(d_stale))
    print("malformed lines=" + str(len(malformed)))
    for m in malformed:
        print("  malformed: " + m)
    return 0


def verify_chain(con):
    prev = GENESIS
    for seq, db, op, row_id, ph, eh, at in con.execute("SELECT seq, db, op, row_id, prev_hash, entry_hash, at FROM audit_ledger ORDER BY seq"):
        calc = sha256_text(ph + canon({"db": db, "op": op, "row_id": row_id, "at": at}))
        if ph != prev or calc != eh:
            return seq
        prev = eh
    return None


def approved_status(s):
    if not s:
        return False
    t = s.lower()
    return "approved" in t or "locked" in t or t.startswith("final")


def scan_duplicates(root):
    lines = 0
    line_dups = 0
    for f, kind in iter_doc_files(root):
        if f.suffix != ".jsonl":
            continue
        seen = set()
        for raw in f.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line:
                continue
            lines += 1
            h = sha256_text(line)
            if h in seen:
                line_dups += 1
            seen.add(h)
    hashes = {}
    file_dups = []
    empty_files = 0
    for f, kind in iter_doc_files(root):
        if f.suffix == ".jsonl":
            continue
        content = f.read_text(encoding="utf-8")
        if not content:
            empty_files += 1
            continue
        h = sha256_text(content)
        rel = f.relative_to(root).as_posix()
        if h in hashes:
            file_dups.append(rel + " == " + hashes[h])
        else:
            hashes[h] = rel
    return lines, line_dups, file_dups, empty_files


def scan_malformed(root):
    items = []
    r = Path(root)
    read_jsonl(r / ".IDE_Plans" / "brainstorm.jsonl", items, ("id", "at", "kind", "topic", "summary"))
    read_jsonl(r / "docs" / "requirements" / "requirements.jsonl", items, ("id",))
    read_jsonl(r / "docs" / "trace" / "trace.jsonl", items, ("from_id", "to_id"))
    read_jsonl(r / "docs" / "checklist_runs.jsonl", items, ("run_id", "template"))
    for f, kind in iter_doc_files(root):
        if f.suffix != ".json":
            continue
        load_json_obj(f.read_text(encoding="utf-8"), f.relative_to(r).as_posix(), items)
    return items


def missing_findings(root, rows):
    findings = []
    for f, kind in iter_doc_files(root):
        if kind not in ("brainstorm", "master"):
            continue
        try:
            obj = json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            continue
        if not isinstance(obj, dict):
            continue
        rel = f.relative_to(root).as_posix()
        for m in doc_refs(obj, ("master",)):
            if not ref_exists(root, m):
                findings.append("master '" + m + "' referenced by " + rel + " not on disk")
                continue
            if m.endswith(".json") and not any(p.endswith("/" + m) or p == m for p in rows):
                findings.append("master '" + m + "' referenced by " + rel + " has no documents row")
                continue
            mf = Path(root) / ".IDE_Plans" / m
            if not mf.exists():
                continue
            try:
                mobj = json.loads(mf.read_text(encoding="utf-8"))
            except ValueError:
                continue
            if not isinstance(mobj, dict):
                continue
            for pn in doc_refs(mobj, ("plan",)):
                if not ref_exists(root, pn):
                    findings.append("plan '" + pn + "' referenced by master " + m + " not on disk")
                elif pn.endswith(".json") and not any(p.endswith("/" + pn) or p == pn for p in rows):
                    findings.append("plan '" + pn + "' referenced by master " + m + " has no documents row")
    return findings


def conflict_findings(root):
    findings = []
    masters = [(mf, ref_initiative(mf.name)) for mf, k in iter_doc_files(root) if k == "master"]
    brains = [ref_initiative(bf.name) for bf, k in iter_doc_files(root) if k == "brainstorm"]
    for f, kind in iter_doc_files(root):
        if kind not in ("brainstorm", "master", "plan"):
            continue
        try:
            obj = json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            continue
        if not isinstance(obj, dict):
            continue
        rel = f.relative_to(root).as_posix()
        status = obj.get("status") if isinstance(obj.get("status"), str) else None
        if kind == "plan":
            refs = doc_refs(obj, ("master",))
            parent = refs[0] if refs else None
            if parent is None:
                plan_init = ref_initiative(f.name)
                matched = any(initiative_matches(mi, plan_init) for _, mi in masters)
                seq_started = any(initiative_matches(bi, plan_init) for bi in brains)
                if (not masters) or (seq_started and not matched):
                    findings.append("orphan plan " + rel + " - no master reference and no matching master document exists")
            elif not ref_exists(root, parent):
                if approved_status(status):
                    findings.append("approved plan " + rel + " has missing parent '" + parent + "'")
                else:
                    findings.append("plan " + rel + " references missing master '" + parent + "'")
        elif kind == "master":
            refs = doc_refs(obj, ("brainstorm",))
            parent = refs[0] if refs else None
            if parent is not None and approved_status(status) and not ref_exists(root, parent):
                findings.append("approved master " + rel + " has missing parent '" + parent + "'")
    return findings


def cmd_verify(root):
    store = Path(root) / "store"
    p = store / "store.db"
    rc = 0
    rows = {}
    if not p.exists():
        print("store.db: missing")
        rc = 1
    else:
        con = open_db(str(p))
        if quick_ok(con):
            print("store.db: quick_check ok")
        else:
            print("store.db: quick_check FAILED")
            rc = 1
        seq = verify_chain(con)
        if seq is None:
            print("audit chain: ok")
        else:
            print("audit chain: broken at seq " + str(seq))
            rc = 1
        rows = doc_rows(con)
        con.close()
    lines, line_dups, file_dups, empty_files = scan_duplicates(root)
    print("duplicate check: jsonl_lines=" + str(lines) + " duplicate_lines=" + str(line_dups) + " duplicate_content_files=" + str(len(file_dups)) + " empty_files=" + str(empty_files))
    for d in file_dups:
        print("  duplicate file: " + d)
    if line_dups or file_dups:
        rc = 1
    mal = scan_malformed(root)
    print("malformed check: " + str(len(mal)))
    for m in mal:
        print("  malformed: " + m)
    if mal:
        rc = 1
    miss = missing_findings(root, rows)
    print("missing check: " + str(len(miss)))
    for m in miss:
        print("  missing: " + m)
    if miss:
        rc = 1
    conflicts = conflict_findings(root)
    print("conflict check: " + str(len(conflicts)))
    for c in conflicts:
        print("  conflict: " + c)
    if conflicts:
        rc = 1
    stale_docs = []
    for pth, row in rows.items():
        fp = Path(root) / pth
        if not fp.exists():
            stale_docs.append(pth + " (missing on disk)")
            continue
        try:
            cur_hash = sha256_text(fp.read_text(encoding="utf-8"))
        except OSError:
            stale_docs.append(pth + " (unreadable)")
            continue
        if cur_hash != row[3]:
            stale_docs.append(pth)
    print("stale documents: " + str(len(stale_docs)))
    for s in stale_docs:
        print("  stale: " + s)
    if stale_docs:
        rc = 1
    return rc


def cmd_backup(root):
    store = Path(root) / "store"
    bdir = store / "backup"
    bdir.mkdir(parents=True, exist_ok=True)
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    p = store / "store.db"
    if not p.exists():
        print("store.db: missing")
        return 1
    con = open_db(str(p))
    dest = bdir / ("store-" + ts + ".db")
    con.execute("VACUUM INTO ?", (str(dest),))
    con.close()
    print("backup " + str(dest))
    return 0


def cmd_stage_gate(root, stage):
    store = Path(root) / "store"
    con = open_db(str(store / "store.db"))
    rows = con.execute(
        "SELECT run_id, template_id, input_hashes, run_at, independence FROM checklist_runs WHERE stage=? ORDER BY run_at DESC",
        (stage,),
    ).fetchall()
    if not rows:
        print("stage " + stage + ": no runs")
        con.close()
        return 1
    for run_id, tmpl, ih, run_at, indep in rows:
        decl = {}
        if ih:
            try:
                decl = json.loads(ih)
            except ValueError:
                decl = {}
        stale = False
        for rel in decl:
            fp = Path(root) / rel
            cur = sha256_text(fp.read_text(encoding="utf-8")) if fp.exists() else "MISSING"
            if cur != decl[rel]:
                stale = True
        state = "STALE" if stale else "FRESH"
        remedy = "rerun " + tmpl if stale else "none"
        print(run_id + " " + state + " independence=" + str(indep) + " remedy=" + remedy)
    con.close()
    return 0


def main(argv):
    root = argv[1]
    args = list(argv[2:])
    while args and args[0] == "--root":
        root = args[1]
        args = args[2:]
    if not args:
        malformed = []
        bad = validate_templates(root, malformed)
        if bad:
            for path, missing in bad:
                print("REJECTED " + path + " missing=" + ",".join(missing))
            return 2
        return project(root, malformed)
    cmd = args[0]
    rest = args[1:]
    if cmd == "--verify":
        return cmd_verify(root)
    if cmd == "--backup":
        return cmd_backup(root)
    if cmd == "--stage-gate":
        return cmd_stage_gate(root, rest[0] if rest else "")
    print("unknown command " + cmd)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
PYEOF