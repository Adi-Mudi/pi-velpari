---
name: velpari-standards
description: Pi-Velpari Standards library (Phase 3) — catalogue of domain overlays (medical / automotive / payments / healthcare / etc.). Use when the developer asks to configure standards, pick a regulatory overlay, or apply domain-specific requirements to a Velpari run.
---

# Standards Library

The standards library is Velpari's domain overlay system. Each overlay is a self-contained bundle that adds:

- Extra mandatory sections to the PRD / design / testplan outputs
- Extra scout roles (e.g. `design-safety-analyzer` for IEC 62304)
- Extra doctor checks at the publish gate

## Catalog

The catalogue lives at `skills/standards/catalogue.json`. Each entry:

```json
{
  "id": "<profile-id>",
  "version": "1.0.0",
  "label": "<human label>",
  "standards": ["IEC 62304:2006", "ISO 14971:2019"],
  "scopes": ["medical-device"],
  "inferenceSignals": ["fda", "iec 62304", "patient"]
}
```

| Field | Meaning |
|---|---|
| `id` | Stable identifier (folder name under `skills/standards/overlays/<id>/`) |
| `version` | SemVer — bumps when the overlay's sections change |
| `standards` | Human list of standards the overlay enforces |
| `scopes` | Topical scopes the overlay applies to |
| `inferenceSignals` | Phrases that hint the overlay applies during brainstorm |

## Overlay folder layout

```
skills/standards/overlays/<id>/
├── profile.json          # full overlay definition (see CatalogueOverlay)
├── sections/
│   ├── prd-extra.md      # extra mandatory PRD sections
│   ├── design-extra.md   # extra mandatory design sections
│   └── testplan-extra.md
├── scouts/
│   └── design-<specialist>.md   # overlay-specific scout role
└── doctor/
    └── check-overlay.md # overlay-specific doctor checks
```

## Bundled overlays (v1.0)

- `none` — common core only (RFC 2119 + EARS); zero domain overlay

Future overlays (Phase 6): `medical-device-b`, `medical-device-c`,
`automotive-asil-b`, `automotive-asil-d`, `payments-pci-dss-4`,
`us-healthcare-phi`, `eu-personal-data`, `industrial-ot`,
`safety-critical-generic`.

## Authoring a new overlay

1. Copy `skills/standards/overlays/_template/` to `skills/standards/overlays/<your-id>/`
2. Edit `profile.json` — set `id`, `label`, `standards`, `scopes`, `inferenceSignals`, `requiredSections`, `extraScouts`, `doctorChecks`
3. Add overlay entry to `skills/standards/catalogue.json`
4. Write the section templates under `sections/`
5. (Optional) Add a scout under `scouts/<role>.md`
6. (Optional) Add a doctor check under `doctor/check-overlay.md`
7. Run `npm test` to verify the loader + merge behave correctly
8. Open a PR — the catalogue is the contract

## Programmatic API

Velpari's L0 modules expose:

- `loadCatalogue(cwd)` — returns the parsed catalogue or `null`
- `loadOverlay(cwd, id)` — returns the parsed overlay profile or `null`
- `mergeOverlay(stage, baseTemplate, overlay)` — appends overlay sections to a stage output

Doctor gate uses `gateStandardsProfile(state)` to verify the referenced overlay exists in the catalogue.

## Discovery

`pi-interactive-subagents` (and Pi itself) discover skills from the package's `skills/` directory. The parent skill `velpari-standards` makes the standards library discoverable from the LLM's skill list.
