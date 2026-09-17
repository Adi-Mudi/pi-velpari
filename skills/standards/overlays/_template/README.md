# Overlay Authoring Template

This folder is a **template** for authoring a new standards overlay.
To create one:

1. **Copy this folder** to `skills/standards/overlays/<your-id>/`
   (replace `<your-id>` with a stable identifier — folder name becomes the overlay id)
2. Edit `profile.json` (see `profile.template.json` below)
3. Edit section templates under `sections/`
4. (Optional) Add a scout role under `scouts/<role>.md`
5. (Optional) Add a doctor check under `doctor/check-overlay.md`
6. Register the overlay in `skills/standards/catalogue.json`

## profile.json shape

```json
{
  "id": "<your-id>",
  "version": "1.0.0",
  "label": "Human-friendly label",
  "standards": ["IEC 62304:2006", "ISO 14971:2019"],
  "scopes": ["medical-device"],
  "inferenceSignals": ["medical device", "fda", "iec 62304", "patient"],
  "requiredSections": {
    "prd": [
      "## Software Safety Classification",
      "## Risk Management Summary"
    ],
    "design": [
      "## Software Architectural Design (IEC 62304 §5.3)"
    ],
    "testplan": [
      "## Verification per IEC 62304 §5.7"
    ]
  },
  "extraScouts": [
    {
      "role": "overlay-design-safety-analyzer",
      "description": "Maps design decisions to safety class A/B/C",
      "reportPathTemplate": "<scoutReportDir>/safety-analyzer.json"
    }
  ],
  "doctorChecks": [
    "Every FR has a Software Safety Classification (A/B/C).",
    "Every risk control measure traces to a design decision."
  ]
}
```

## sections/prd-extra.md

Add a heading per `requiredSections.prd` entry. Each heading gets its
content during the LLM's PRD pass — your template file just lists the
heading names.

## sections/design-extra.md

Same pattern for `requiredSections.design`.

## sections/testplan-extra.md

Same pattern for `requiredSections.testplan`.

## scouts/<role>.md

A standard Pi agent definition file. The role MUST start with the
prefix `overlay-` (so the registry's `isOverlayRole` recognizes it).
Example frontmatter:

```markdown
---
name: overlay-design-safety-analyzer
description: Map every design decision in the working copy to a software safety class (A/B/C per IEC 62304).
---
```

## doctor/check-overlay.md

One check per `doctorChecks` entry, written as a Markdown bullet list.
The check-registry helper loads these verbatim into the `/velpari-doctor`
output under the overlay section.

## How the registry uses this

1. `/velpari-configure-standards` lists overlays from `catalogue.json`.
2. User picks one → saved to `.pi/velpari/standards-profile.json` + `state.json`.
3. `core/standards-overlay.ts:loadOverlay` reads `profile.json`.
4. `core/standards-overlay.ts:mergeOverlay` injects `requiredSections.*`
   into the stage output template before the Change Log.
5. `stages/registry.ts:runStage` reads `extraScouts` and spawns them
   in parallel with the 4 base scouts.
6. `doctor/index.ts` reads `doctorChecks` from `check-overlay.md` and
   surfaces them under the per-overlay section.
