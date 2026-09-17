# Standards Library

The standards library is Velpari's domain overlay system. Each overlay
is a self-contained bundle that adds:

- **Extra mandatory sections** to the PRD / design / testplan outputs
- **Extra scout roles** (e.g. `overlay-design-safety-analyzer` for IEC 62304)
- **Extra doctor checks** at the publish gate

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

## Profile shape

Each `profile.json` carries the catalogue fields PLUS the run-time
mechanics. v1.4.0 added an optional `loggingRequirements` block:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Same as catalogue id |
| `version` | string | SemVer of the overlay itself |
| `label` | string | Human label |
| `standards` | string[] | Same as catalogue standards |
| `scopes` | string[] | Same as catalogue scopes |
| `inferenceSignals` | string[] | Same as catalogue inference signals |
| `requiredSections` | object | PRD / design / testplan sections this overlay injects |
| `extraScouts` | object[] | Overlay-specific scouts (role prefix `overlay-`) |
| `doctorChecks` | string[] | Overlay-specific doctor rules |
| **`loggingRequirements`** | object (v1.4.0) | Optional. When present, the doctor's `checkLoggingPlanSection` enforces these constraints on the published logging plan |

The `loggingRequirements` block has 6 fields: `regimes`, `retentionMonths`, `tamperEvident`, `piiRedaction`, `dailyReview`, `extraEventCategories`. See any of the 4 bundled overlays' `profile.json` for an example.

## Overlay folder layout

```
skills/standards/overlays/<id>/
├── profile.json          # full overlay definition (see CatalogueOverlay)
├── sections/
│   ├── prd-extra.md      # extra mandatory PRD sections
│   ├── design-extra.md   # extra mandatory design sections
│   └── testplan-extra.md
├── scouts/
│   └── <role>.md         # overlay-specific scout role (prefix: overlay-)
└── doctor/
    └── check-overlay.md  # overlay-specific doctor checks (one bullet per rule)
```

## Bundled overlays

| ID | Standards | Status |
|---|---|---|
| `none` | RFC 2119 + EARS | Default (always available) |
| `medical-device-b` | IEC 62304:2006 + ISO 14971 + ISO 13485 | Class B medical device |
| `industrial-ot` | IEC 61508:2010 + IEC 62443-3-3:2013 + IEC 61131-3:2013 | Industrial / process control |
| `financial-payments` | PCI-DSS v4.0 + SOX §404 + FFIEC CAT + ISO 27001:2022 | Financial / banking / card payments |
| `cloud-saas` | SOC 2 Type II + ISO 27001:2022 + NIST 800-53 Rev 5 + ISO 27017 + ISO 27018 | Multi-tenant cloud SaaS |

Future overlays (planned):
- `medical-device-c` — IEC 62304 Class C
- `automotive-asil-b` — ISO 26262 ASIL B
- `automotive-asil-d` — ISO 26262 ASIL D
- `us-healthcare-phi` — HIPAA + HITRUST
- `eu-personal-data` — GDPR
- `avionics-dal-c` — DO-178C DAL C
- `railway-sil-3` — EN 50128 SIL 3
- `csp-aws` — AWS-specific shared-responsibility additions

## Authoring a new overlay

1. **Copy the template**

   ```sh
   cp -r skills/standards/overlays/_template/ skills/standards/overlays/<your-id>/
   ```

2. **Edit `profile.json`** — set `id`, `label`, `standards`, `scopes`,
   `inferenceSignals`, `requiredSections`, `extraScouts`, `doctorChecks`

3. **Write the section templates** under `sections/` (one file per stage:
   `prd-extra.md`, `design-extra.md`, `testplan-extra.md`)

4. **Add a scout** (optional) — `scouts/<role>.md`. Role MUST start
   with `overlay-` prefix. Example:

   ```markdown
   ---
   name: overlay-design-safety-analyzer
   description: Map every design decision to IEC 62304 safety class A/B/C.
   ---
   ```

5. **Add a doctor check** (optional) — `doctor/check-overlay.md`. One
   bullet per rule. The check-registry loads these verbatim into the
   `/velpari-doctor` overlay section.

6. **Register the overlay** in `skills/standards/catalogue.json`:

   ```json
   {
     "overlays": [
       ...existing entries,
       {
         "id": "<your-id>",
         "version": "1.0.0",
         "label": "<your label>",
         "standards": ["<standard-1>"],
         "scopes": ["<scope>"],
         "inferenceSignals": ["<phrase>"]
       }
     ]
   }
   ```

7. **Verify** — run `npm test` to exercise the catalogue loader, overlay
   loader, and mergeOverlay behavior. Run `/velpari-configure-standards`
   in interactive mode to confirm the overlay is selectable.

## Programmatic API

Velpari's L0 modules expose:

- `loadCatalogue(cwd)` — returns the parsed catalogue or `null`
- `findOverlay(catalogue, id)` — looks up an overlay by id
- `loadOverlay(cwd, id)` — returns the parsed overlay profile or `null`
- `mergeOverlay(stage, baseTemplate, overlay)` — appends overlay sections
- `loadOverlayChecks(cwd, overlayId)` — reads `doctor/check-overlay.md`

Doctor gate uses:

- `gateStandardsProfile(state, cwd)` — verifies the active overlay exists
  in the catalogue (catches dangling references)
- `gateADR(workingContent)` — verifies the ADR section is valid

## Discovery

`pi-interactive-subagents` (and Pi itself) discover skills from the
package's `skills/` directory. The parent skill `velpari-standards.md`
makes the standards library discoverable from the LLM's skill list.
