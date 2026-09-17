# industrial-ot Design extra sections

These headings are appended to the standard design template when the
`industrial-ot` overlay is active.

## Safety Instrumented System Architecture

The Safety Instrumented System (SIS) is a separate, independent
system that takes the process to a safe state when the BPCS fails.
The SIS MUST be physically and logically separate from the BPCS.

| Subsystem | Purpose | Separation strategy | Independence evidence |
|---|---|---|---|
| BPCS | Basic process control | <separation> | <evidence> |
| SIS | Safety instrumented function | <separation> | <evidence> |

Document:

1. **Independent sensor chain** — SIS sensors are NOT shared with BPCS
2. **Independent logic solver** — SIS logic runs on different hardware
3. **Independent final element** — SIS actuators are NOT shared with BPCS
4. **Independent power** — SIS has its own UPS / battery
5. **Independent communication** — SIS network is physically separate

## Safety-Related Functions

For every safety-related function identified in the PRD's
`## Safety Integrity Level Classification`, document the
implementation.

| Function ID | Description | SIL | Sensor chain | Logic solver | Final element |
|---|---|---|---|---|---|
| SRF-001 | <function> | 1 / 2 / 3 / 4 | <sensors> | <solver> | <actuator> |
| SRF-002 | <function> | 1 / 2 / 3 / 4 | <sensors> | <solver> | <actuator> |

### Proof test interval

| Function ID | SIL | Required proof test interval | Actual interval | Diagnostic coverage |
|---|---|---|---|---|
| SRF-001 | <SIL> | <interval> | <interval> | <%> |

Proof test coverage is the fraction of dangerous undetected failures
that the proof test detects. The overlay requires ≥ 90% diagnostic
coverage for SIL 3 / SIL 4 functions.

## Cybersecurity Zones and Conduits (Design)

The IEC 62443 design that implements the zones and conduits declared
in the PRD.

| Zone ID | Network segment | Firewall / gateway | Authentication | Monitoring |
|---|---|---|---|---|
| Z-001 | <segment> | <firewall> | <auth> | <monitoring> |
| Z-002 | <segment> | <firewall> | <auth> | <monitoring> |

| Conduit ID | From → To | Protocol allowlist | Default deny? | Inspection |
|---|---|---|---|---|
| C-001 | Z-001 → Z-002 | <protocol list> | yes / no | <IDS/IPS> |

## SIL Decomposition

When a single safety function is implemented by redundant subsystems
that together achieve the required SIL, document the decomposition.

| Function ID | Required SIL | Subsystem A | Subsystem A SIL | Subsystem B | Subsystem B SIL |
|---|---|---|---|---|---|
| SRF-001 | 3 | <description> | 2 | <description> | 2 |
| SRF-002 | 4 | <description> | 3 | <description> | 3 |

Each decomposition MUST demonstrate:

1. **Independence** — subsystems fail independently
2. **No common-cause** — no shared component (power, sensor, software)
3. **Cross-checked** — failure of one subsystem is detected by the other

## Failure Mode Analysis

The FMEA / FMEDA table that drove the SIL allocation. One row per
component or subsystem.

| Subsystem | Failure mode | Effect | Severity | Probability | Detection | SIL impact |
|---|---|---|---|---|---|---|
| <subsystem> | <mode> | <effect> | <sev> | <prob> | <detection> | <impact> |

The overlay requires analysis of:

- **Single-point failures** (no redundancy)
- **Common-cause failures** (both subsystems fail same way)
- **Dangerous undetected failures** (no diagnostic, no proof test)

The `design-sil-analyzer` scout flags any module that lacks a failure
mode entry.
