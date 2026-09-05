#!/usr/bin/env bash
#
# e2e-preflight.sh - Pre-flight gates for Velpari v1.0 E2E testing
#
# Verifies the extension is ready to load into a real Pi session.
# Run from the Pi-Velpari project root.
#
# Exit codes:
#   0 = all gates passed
#   1 = a gate failed (details on stderr)

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

FAILED=0

# ---------- helpers ----------
pass() { printf "  PASS  %s\n" "$1"; }
fail() { printf "  FAIL  %s\n" "$1"; shift; printf "        %s\n" "$@"; FAILED=$((FAILED+1)); }
section() { printf "\n=== %s ===\n" "$1"; }

# ---------- Phase 1: Build ----------
section "Build"
if npm run build > /tmp/velpari-build.log 2>&1; then
  pass "npm run build"
else
  fail "npm run build" "see /tmp/velpari-build.log"
fi

# ---------- Phase 2: Unit tests ----------
section "Unit tests"
if npm test > /tmp/velpari-test.log 2>&1; then
  # Count pass/fail/todo from TAP per-line output rather than the
  # aggregated `# pass N` summary. Node's --test runs files in parallel
  # and the aggregated totals can be inconsistent across runs.
  PASS_COUNT=$(grep -cE "^ok [0-9]+ - " /tmp/velpari-test.log || true)
  FAIL_COUNT=$(grep -cE "^not ok [0-9]+ - " /tmp/velpari-test.log || true)
  TODO_COUNT=$(grep -cE "^# todo " /tmp/velpari-test.log | tail -1 || true)
  if [ "$FAIL_COUNT" -eq 0 ]; then
    pass "npm test ($PASS_COUNT pass + 0 fail + 0 todo)"
  else
    fail "npm test" "got $PASS_COUNT pass + $FAIL_COUNT fail + $TODO_COUNT todo (failures must be 0)"
  fi
else
  fail "npm test" "see /tmp/velpari-test.log"
fi

# ---------- Phase 3: Strict typecheck ----------
section "Strict typecheck"
if npx tsc --noEmit > /tmp/velpari-tsc.log 2>&1; then
  pass "tsc --noEmit"
else
  fail "tsc --noEmit" "see /tmp/velpari-tsc.log"
fi

# ---------- Phase 4: Module loadable ----------
section "Module loadable"
INDEX_JS="dist/pi-extension/src/index.js"
if [ ! -f "$INDEX_JS" ]; then
  fail "module exists" "$INDEX_JS not found"
else
  if node -e "import('./$INDEX_JS').then(m => { if (typeof m.default !== 'function') { console.error('FAIL: default export is not a function'); process.exit(1); } console.log('PASS: default export is a function'); }).catch(e => { console.error('FAIL:', e.message); process.exit(1); })" > /tmp/velpari-module.log 2>&1; then
    pass "module loads + default export is a function"
  else
    fail "module loads" "$(cat /tmp/velpari-module.log)"
  fi
fi

# ---------- Phase 5: package.json metadata ----------
section "package.json metadata"
node -e "
const p = require('./package.json');
let ok = true;
if (!p.peerDependencies || !p.peerDependencies['@earendil-works/pi-coding-agent']) {
  console.error('FAIL: peer dep @earendil-works/pi-coding-agent missing');
  ok = false;
}
if (!p.pi || !Array.isArray(p.pi.extensions) || p.pi.extensions.length === 0) {
  console.error('FAIL: pi.extensions field missing or empty');
  ok = false;
} else if (!p.pi.extensions[0].endsWith('dist/index.js') && !p.pi.extensions[0].endsWith('dist/pi-extension/src/index.js')) {
  console.error('FAIL: pi.extensions entry does not point at dist/index.js: ' + p.pi.extensions[0]);
  ok = false;
}
if (p.type !== 'module') {
  console.error('FAIL: package.json type is not module');
  ok = false;
}
if (ok) console.log('PASS: package.json metadata');
process.exit(ok ? 0 : 1);
" > /tmp/velpari-pkg.log 2>&1 && pass "package.json (peer dep + pi.extensions + type=module)" || fail "package.json metadata" "$(cat /tmp/velpari-pkg.log)"

# ---------- Phase 6: Node version ----------
section "Node version"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
NODE_MINOR=$(node -p 'process.versions.node.split(".")[1]')
NODE_OK="false"
if [ "$NODE_MAJOR" -gt 22 ]; then
  NODE_OK="true"
elif [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -ge 19 ]; then
  NODE_OK="true"
fi
if [ "$NODE_OK" = "true" ]; then
  pass "node $(node --version) (>=22.19.0 required)"
else
  fail "node version" "got $(node --version), need >=22.19.0"
fi

# ---------- Phase 7: Pi binary available ----------
section "Pi binary"
if command -v pi > /dev/null 2>&1; then
  PI_VERSION=$(pi --version 2>/dev/null || echo "unknown")
  pass "pi binary available ($PI_VERSION)"
else
  fail "pi binary" "not found in PATH"
fi

# ---------- Summary ----------
echo ""
echo "================================================="
if [ "$FAILED" -eq 0 ]; then
  echo "ALL PRE-FLIGHT GATES PASSED"
  echo "Ready for E2E testing (Phase 2+)"
  exit 0
else
  echo "PRE-FLIGHT GATES FAILED: $FAILED"
  exit 1
fi
