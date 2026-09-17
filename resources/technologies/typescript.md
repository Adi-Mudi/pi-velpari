---
id: typescript
name: TypeScript
keywords: ["typescript", "ts", "tsc", "tsconfig", "ts-node", "tsx", "deno", "vite", "esbuild", "swc"]
---

# TypeScript Resource

Craft for TypeScript projects. All sections sourced from official TypeScript and adjacent tooling documentation.

## Core rules

1. Enable strict mode in `tsconfig.json`: `"strict": true` is the umbrella flag; the stricter family (`noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`) catches real bugs (source: https://www.typescriptlang.org/tsconfig/#strict).
2. Use `unknown` over `any` at API boundaries — `any` defeats type checking; `unknown` forces the consumer to narrow (source: https://www.typescriptlang.org/docs/handbook/2/narrowing.html).
3. Prefer `readonly` for fields and array/tuple types that should not mutate after construction (source: https://www.typescriptlang.org/docs/handbook/2/objects.html#readonly-properties).
4. Use discriminated unions over optional fields for state machines — `type State = { kind: "loading" } | { kind: "ok"; data: T } | { kind: "error"; err: E }` makes illegal states unrepresentable (source: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions).
5. Pin Node typings to the engine: `"engines": { "node": ">=20" }` in `package.json` plus `@types/node` matching the major (source: https://www.typescriptlang.org/docs/handbook/declaration-files/consumption.html).

## Testing patterns

1. Tests live in `*.test.ts` next to the source file or under `test/` (project convention); run with `node --test` (Node 20+ native) or `vitest` / `jest` per the framework (source: https://nodejs.org/api/test.html).
2. Type-only tests use `tsd` or `expect-type`; runtime tests use the project's chosen runner (source: https://github.com/SamVerschueren/tsd).
3. Property-based testing for parsers and serializers with `fast-check` (source: https://fast-check.dev/).

### Integration testing

1. Integration tests live in `test/integration/` or under a build tag; CI runs them separately from unit tests (source: https://nodejs.org/api/test.html#test-runner-execution-model).
2. Mock only at process boundaries (HTTP, filesystem) — never mock a same-process TypeScript module under test (source: https://martinfowler.com/articles/mocksArentStubs.html).

## Tooling and limits

1. Build with `tsc` (type-check only) plus a bundler (`esbuild`, `swc`, `vite`) for emit; do not run `tsc --build` for production emit in most projects (source: https://www.typescriptlang.org/docs/handbook/project-references.html).
2. `tsconfig.json` must extend a baseline (`@tsconfig/node20`, `@tsconfig/strictest`) — bare `{}` is rarely correct (source: https://github.com/tsconfig/bases).
3. Watch mode: `tsc --noEmit --watch` for type-checks; bundler watch for emit (source: https://www.typescriptlang.org/docs/handbook/2/basic-types.html).

## Common mistakes

1. Using `any` to silence the compiler. The bug moves from the error site to runtime; prefer `unknown` plus narrowing (source: https://www.typescriptlang.org/docs/handbook/2/narrowing.html).
2. Optional chaining where the value should be required. `foo?.bar` hides a missing `foo` — if it should always exist, type it non-optional (source: https://www.typescriptlang.org/docs/handbook/2/objects.html#property-modifiers).
3. `as` casts without a guard. `x as Foo` is a lie to the compiler; write a type predicate (`x is Foo`) or restructure the data (source: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates).
4. Skipping the build step. "It compiles in my editor" is not the same as `tsc --noEmit` passing — CI must run the compiler (source: https://www.typescriptlang.org/docs/handbook/2/basic-types.html).

_Last updated: 2026-09-14_
