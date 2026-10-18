#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJ="$ROOT/scripts/project-store.sh"
STORE="$ROOT/store"
FIXROOT="$(mktemp -d)"
BACKUP="$(mktemp)"
PASSES=0
FAILS=0

pass() {
  PASSES=$((PASSES + 1))
  echo "PASS $1"
}

fail() {
  FAILS=$((FAILS + 1))
  echo "FAIL $1"
}

cleanup() {
  rc=$?
  rm -f "$STORE/store.db" "$STORE/store.db-wal" "$STORE/store.db-shm"
  if [ -s "$BACKUP" ]; then
    cp "$BACKUP" "$STORE/store.db"
  fi
  rm -f "$BACKUP"
  rm -rf "$FIXROOT"
  echo "selftest-restored original store.db and removed fixtures"
  exit $rc
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "a: backup current store.db"
cp "$STORE/store.db" "$BACKUP"
if [ -s "$BACKUP" ]; then
  pass "a-backup-nonempty"
else
  fail "a-backup-nonempty"
fi

echo "b: fresh rebuild of the real store"
rm -f "$STORE/store.db" "$STORE/store.db-wal" "$STORE/store.db-shm"
rc=0
bash "$PROJ" > "$FIXROOT/rebuild.out" 2>&1 || rc=$?
if [ "$rc" -eq 0 ]; then
  pass "b-rebuild-exit0"
else
  fail "b-rebuild-exit0"
  cat "$FIXROOT/rebuild.out"
fi
if grep -q "rebuild=yes" "$FIXROOT/rebuild.out"; then
  pass "b-rebuild-flag"
else
  fail "b-rebuild-flag"
fi
python3 - "$STORE/store.db" <<'PYEOF'
import sqlite3
import sys
con = sqlite3.connect(sys.argv[1])
for t in ("brainstorm", "artifacts", "artifact_revisions", "baselines", "traces", "checklist_runs", "documents", "audit_ledger"):
    n = con.execute("SELECT COUNT(*) FROM " + t).fetchone()[0]
    print("rowcount " + t + "=" + str(n))
con.close()
PYEOF

echo "c: duplicate jsonl line fixture"
D="$FIXROOT/dup"
mkdir -p "$D/.IDE_Plans"
LINE='{"id":"d1","at":"2026-10-18T00:00:00Z","kind":"decision","topic":"t","summary":"s"}'
printf '%s\n%s\n' "$LINE" "$LINE" > "$D/.IDE_Plans/brainstorm.jsonl"
rc=0
bash "$PROJ" --root "$D" > "$FIXROOT/dup.out" 2>&1 || rc=$?
if [ "$rc" -eq 0 ] && grep -q "brainstorm added=1 duplicate_lines=1" "$FIXROOT/dup.out"; then
  pass "c-duplicate-lines-detected"
else
  fail "c-duplicate-lines-detected"
  cat "$FIXROOT/dup.out"
fi

echo "d: malformed jsonl line fixture"
M="$FIXROOT/mal"
mkdir -p "$M/.IDE_Plans"
GOOD='{"id":"m1","at":"2026-10-18T00:00:00Z","kind":"decision","topic":"t","summary":"s"}'
BAD='{"id":"m2",'
printf '%s\n%s\n' "$GOOD" "$BAD" > "$M/.IDE_Plans/brainstorm.jsonl"
rc=0
bash "$PROJ" --root "$M" > "$FIXROOT/mal.out" 2>&1 || rc=$?
if [ "$rc" -eq 0 ] && grep -q "malformed lines=1" "$FIXROOT/mal.out"; then
  pass "d-projector-survives-malformed"
else
  fail "d-projector-survives-malformed"
  cat "$FIXROOT/mal.out"
fi
rc=0
bash "$PROJ" --root "$M" --verify > "$FIXROOT/malverify.out" 2>&1 || rc=$?
if [ "$rc" -eq 1 ] && grep -q "malformed check: 1" "$FIXROOT/malverify.out"; then
  pass "d-verify-fails-on-malformed"
else
  fail "d-verify-fails-on-malformed"
  cat "$FIXROOT/malverify.out"
fi

echo "e: multi-word missing/conflict/orphan fixtures"
A="$FIXROOT/refs"
mkdir -p "$A/.IDE_Plans"
printf '%s\n' '{"doc_type":"brainstorm","status":"locked final","version":"v1.2","Documents":{"truth":"store_revamp_master_20261018_v1.0.json"}}' > "$A/.IDE_Plans/store_revamp_brainstorm_20261018.json"
printf '%s\n' '{"doc_type":"plan","status":"draft","master":"foo_bar_master_20261018_v1.0.json"}' > "$A/.IDE_Plans/foo_bar_stage1_plan_20261018_1000_v1.0.json"
printf '%s\n' '{"doc_type":"master_plan","initiative":"solo","version":"v1.0"}' > "$A/.IDE_Plans/solo_master_20261018_v1.0.json"
printf '%s\n' '{"doc_type":"plan","note":"no master reference"}' > "$A/.IDE_Plans/solo_stage2_plan_20261018_1000_v1.0.json"
printf '%s\n' '{"doc_type":"plan","status":"draft","master":"solo_master_20261018_v1.0.json"}' > "$A/.IDE_Plans/solo_plan_20261018_1000_v1.0.json"
rc=0
bash "$PROJ" --root "$A" > "$FIXROOT/refs.out" 2>&1 || rc=$?
if [ "$rc" -eq 0 ]; then
  pass "e-refs-project-ok"
else
  fail "e-refs-project-ok"
  cat "$FIXROOT/refs.out"
fi
rc=0
bash "$PROJ" --root "$A" --verify > "$FIXROOT/refsverify.out" 2>&1 || rc=$?
if [ "$rc" -eq 1 ] && grep -q "missing check: 1" "$FIXROOT/refsverify.out" && grep -q "conflict check: 1" "$FIXROOT/refsverify.out"; then
  pass "e-multword-missing-and-conflict-detected"
else
  fail "e-multword-missing-and-conflict-detected"
  cat "$FIXROOT/refsverify.out"
fi
if ! grep -q "orphan plan" "$FIXROOT/refsverify.out" && ! grep -q "solo_stage2_plan" "$FIXROOT/refsverify.out"; then
  pass "e-solo-stage-plan-not-orphan"
else
  fail "e-solo-stage-plan-not-orphan"
fi
B="$FIXROOT/orph"
mkdir -p "$B/.IDE_Plans"
printf '%s\n' '{"doc_type":"brainstorm","version":"v1.0"}' > "$B/.IDE_Plans/multi_word_brainstorm_20261018.json"
printf '%s\n' '{"doc_type":"plan","status":"draft","note":"no master reference"}' > "$B/.IDE_Plans/multi_word_plan_20261018_1000_v1.0.json"
printf '%s\n' '{"doc_type":"master_plan","initiative":"other","version":"v1.0"}' > "$B/.IDE_Plans/other_master_20261018_v1.0.json"
rc=0
bash "$PROJ" --root "$B" > "$FIXROOT/orph.out" 2>&1 || rc=$?
rc=0
bash "$PROJ" --root "$B" --verify > "$FIXROOT/orphverify.out" 2>&1 || rc=$?
if [ "$rc" -eq 1 ] && grep -q "orphan plan .IDE_Plans/multi_word_plan_20261018_1000_v1.0.json" "$FIXROOT/orphverify.out"; then
  pass "e-multword-orphan-detected"
else
  fail "e-multword-orphan-detected"
  cat "$FIXROOT/orphverify.out"
fi
C="$FIXROOT/small"
mkdir -p "$C/.IDE_Plans"
printf '%s\n' '{"doc_type":"plan","status":"DONE","task":"small_init"}' > "$C/.IDE_Plans/small_init_plan_20261017_1000_v1.0.json"
printf '%s\n' '{"doc_type":"master_plan","initiative":"other","version":"v1.0"}' > "$C/.IDE_Plans/other_master_20261018_v1.0.json"
rc=0
bash "$PROJ" --root "$C" > "$FIXROOT/small.out" 2>&1 || rc=$?
rc=0
bash "$PROJ" --root "$C" --verify > "$FIXROOT/smallverify.out" 2>&1 || rc=$?
if [ "$rc" -eq 0 ] && grep -q "conflict check: 0" "$FIXROOT/smallverify.out"; then
  pass "e-masterless-small-plan-not-orphan"
else
  fail "e-masterless-small-plan-not-orphan"
  cat "$FIXROOT/smallverify.out"
fi

echo "f: status-only hijack fixture"
H="$FIXROOT/hij"
mkdir -p "$H/.IDE_Plans" "$H/docs/requirements" "$H/db-store/store"
printf '%s\n' '{"id":"REQ-0001","kind":"requirement","title":"login","text":"v1","version":1,"status":"draft"}' > "$H/docs/requirements/requirements.jsonl"
printf '%s\n' '{"id":"B-1","at":"2026-10-18T00:00:00Z","kind":"decision","topic":"t","summary":"s","locked":0}' > "$H/.IDE_Plans/brainstorm.jsonl"
printf '%s\n' '{"doc_type":"report","title":"demo"}' > "$H/.IDE_Plans/demo_report_20261018.json"
rc=0
bash "$PROJ" --root "$H" > "$FIXROOT/hij1.out" 2>&1 || rc=$?
if [ "$rc" -eq 0 ]; then
  pass "f-first-project"
else
  fail "f-first-project"
  cat "$FIXROOT/hij1.out"
fi
python3 - "$H/store/store.db" <<'PYEOF'
import sqlite3
import sys
con = sqlite3.connect(sys.argv[1])
con.execute("UPDATE artifacts SET title='HIJACKED' WHERE id='REQ-0001'")
con.commit()
con.close()
PYEOF
printf '%s\n' '{"id":"REQ-0001","kind":"requirement","title":"login","text":"v2","version":2,"status":"confirmed"}' >> "$H/docs/requirements/requirements.jsonl"
printf '%s\n' '{"id":"B-1","at":"2026-10-18T01:00:00Z","kind":"decision","topic":"t","summary":"s","locked":1}' >> "$H/.IDE_Plans/brainstorm.jsonl"
printf '%s\n' '{"doc_type":"report","title":"demo changed"}' > "$H/.IDE_Plans/demo_report_20261018.json"
rc=0
bash "$PROJ" --root "$H" > "$FIXROOT/hij2.out" 2>&1 || rc=$?
if [ "$rc" -eq 0 ] && grep -q "stale_content=[1-9]" "$FIXROOT/hij2.out"; then
  pass "f-document-refresh-reported"
else
  fail "f-document-refresh-reported"
  cat "$FIXROOT/hij2.out"
fi
rc=0
python3 - "$H/store/store.db" "$H/.IDE_Plans/demo_report_20261018.json" <<'PYEOF' || rc=$?
import hashlib
import sqlite3
import sys
con = sqlite3.connect(sys.argv[1])
title, status = con.execute("SELECT title, status FROM artifacts WHERE id='REQ-0001'").fetchone()
locked = con.execute("SELECT locked FROM brainstorm WHERE id='B-1'").fetchone()[0]
dhash, dtitle = con.execute("SELECT content_hash, title FROM documents WHERE path='.IDE_Plans/demo_report_20261018.json'").fetchone()
disk = hashlib.sha256(open(sys.argv[2], "rb").read()).hexdigest()
con.close()
checks = [
    ("f-content-column-hijack-survives", title == "HIJACKED"),
    ("f-status-updated", status == "confirmed"),
    ("f-locked-updated", locked == 1),
    ("f-doc-hash-refreshed", dhash == disk),
    ("f-doc-title-refreshed", dtitle == "demo changed"),
]
for name, ok in checks:
    print(("PASS " if ok else "FAIL ") + name + " title=" + str(title) + " status=" + str(status) + " locked=" + str(locked))
sys.exit(0 if all(ok for _, ok in checks) else 1)
PYEOF
if [ "$rc" -eq 0 ]; then
  PASSES=$((PASSES + 5))
else
  FAILS=$((FAILS + 5))
fi

echo "g: corrupt store.db auto-rebuild fixture"
K="$FIXROOT/corr"
mkdir -p "$K/.IDE_Plans" "$K/db-store/store"
printf '%s\n' '{"id":"g1","at":"2026-10-18T00:00:00Z","kind":"decision","topic":"t","summary":"s"}' > "$K/.IDE_Plans/brainstorm.jsonl"
rc=0
bash "$PROJ" --root "$K" > "$FIXROOT/corr1.out" 2>&1 || rc=$?
printf 'garbage-bytes-not-a-database' > "$K/store/store.db"
rc=0
bash "$PROJ" --root "$K" > "$FIXROOT/corr2.out" 2>&1 || rc=$?
if [ "$rc" -eq 0 ] && grep -q "rebuild=yes" "$FIXROOT/corr2.out"; then
  pass "g-corrupt-db-auto-rebuilt"
else
  fail "g-corrupt-db-auto-rebuilt"
  cat "$FIXROOT/corr2.out"
fi

echo "f7: symlink invariant fixtures"
S1="$FIXROOT/plain"
mkdir -p "$S1/store"
rc=0
bash "$PROJ" --root "$S1" > "$FIXROOT/plain.out" 2>&1 || rc=$?
if [ "$rc" -eq 1 ] && grep -q "not a symlink" "$FIXROOT/plain.out" && grep -q "ln -s db-store/store store" "$FIXROOT/plain.out"; then
  pass "f7-plain-dir-rejected"
else
  fail "f7-plain-dir-rejected"
  cat "$FIXROOT/plain.out"
fi
S2="$FIXROOT/auto"
mkdir -p "$S2/db-store/store"
rc=0
bash "$PROJ" --root "$S2" > "$FIXROOT/auto.out" 2>&1 || rc=$?
if [ "$rc" -eq 0 ] && [ -L "$S2/store" ] && grep -q "created store symlink" "$FIXROOT/auto.out" && [ -f "$S2/store/store.db" ]; then
  pass "f7-symlink-auto-created"
else
  fail "f7-symlink-auto-created"
  cat "$FIXROOT/auto.out"
fi
S3="$FIXROOT/broke"
mkdir -p "$S3"
ln -s nowhere "$S3/store"
rc=0
bash "$PROJ" --root "$S3" > "$FIXROOT/broke.out" 2>&1 || rc=$?
if [ "$rc" -eq 1 ] && grep -q "broken" "$FIXROOT/broke.out"; then
  pass "f7-broken-symlink-rejected"
else
  fail "f7-broken-symlink-rejected"
  cat "$FIXROOT/broke.out"
fi

echo "h: final verify on clean rebuilt state"
rc=0
bash "$PROJ" --verify > "$FIXROOT/final.out" 2>&1 || rc=$?
cat "$FIXROOT/final.out"
if [ "$rc" -eq 0 ]; then
  pass "h-final-verify-green"
else
  fail "h-final-verify-green"
fi

echo "selftest PASS=$PASSES FAIL=$FAILS"
if [ "$FAILS" -gt 0 ]; then
  exit 1
fi
exit 0
