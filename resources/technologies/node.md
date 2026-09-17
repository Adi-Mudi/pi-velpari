---
id: node
name: Node.js
keywords: ["node", "nodejs", "node.js", "npm", "yarn", "pnpm", "corepack", "nvm"]
---

# Node.js Resource

Craft for Node.js projects (runtime only — language idioms live in the `typescript` resource). All sections sourced from official Node.js documentation.

## Core rules

1. Pin the runtime: `"engines": { "node": ">=20.0.0" }` in `package.json`; CI installs the same major (source: https://nodejs.org/api/packages.html#packages).
2. Use ESM (`"type": "module"`) for new projects; legacy CJS works but ESM is the documented default since Node 20 (source: https://nodejs.org/api/esm.html).
3. Streams over string concat for large payloads — `pipeline()` over `.pipe()` chains so errors propagate and resources close (source: https://nodejs.org/api/stream.html).
4. Worker threads for CPU-bound work; child processes for isolation; never block the event loop with synchronous I/O in a server (source: https://nodejs.org/api/worker_threads.html).
5. Use `node:` scheme for built-in imports (`import fs from "node:fs"`) — protects against npm packages shadowing builtins (source: https://nodejs.org/api/packages.html#node-builtins).

## Testing patterns

1. Built-in test runner `node --test` for projects that want zero test dependencies; supports `describe`, `it`, `before/after` (source: https://nodejs.org/api/test.html).
2. Mocking with `node:test` `mock` API (`mock.fn`, `mock.method`) — no extra dependency needed (source: https://nodejs.org/api/test.html#mocking).
3. Coverage via `node --test --experimental-test-coverage` (Node 20+) or `c8` for richer reporting (source: https://nodejs.org/api/test.html#test-runner-execution-model).

### Integration testing

1. Spin up real services with `node:test` `before()` hooks plus a per-test temp dir (`fs.mkdtempSync`); never share global state across tests (source: https://nodejs.org/api/test.html).
2. Use `fetch` (Node 20+ native) with AbortController for HTTP integration tests; assert on status plus structured body (source: https://nodejs.org/api/globals.html#fetch).

## Tooling and limits

1. Use `npm` (bundled), `pnpm`, or `yarn` per project convention; do not mix package managers in one repo — pick one and pin it in `packageManager` (source: https://nodejs.org/api/packages.html#packagemanager).
2. Watch mode: `node --watch` (Node 20+) restarts on file change — replaces `nodemon` for simple cases (source: https://nodejs.org/api/cli.html#--watch).
3. Process supervisor for production: `systemd`, `pm2`, or container orchestrator — `node` alone is not a supervisor (source: https://nodejs.org/api/process.html).
4. Memory limits: default V8 heap is ~1.5 GB on 64-bit; tune with `--max-old-space-size` only when profiled (source: https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-mib).

## Common mistakes

1. Uncaught promise rejections. Node 20+ terminates by default; always `.catch` or `try/await` every async path (source: https://nodejs.org/api/process.html#warning-using-uncaughtexception-correctly).
2. Sync I/O in request handlers. `fs.readFileSync` blocks the event loop; use `fs.promises.readFile` (source: https://nodejs.org/api/fs.html#promises-api).
3. Reading `process.env` at module load. Config can change at runtime; lazy-evaluate env vars or use a config loader that handles defaults (source: https://nodejs.org/api/process.html#processenv).
4. Skipping `corepack enable`. `corepack` ships with Node and pins the package manager version per the `packageManager` field — without it, contributors drift (source: https://nodejs.org/api/corepack.html).

_Last updated: 2026-09-14_
