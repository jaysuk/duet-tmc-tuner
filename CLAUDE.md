# Duet TMC Tuner — notes for Claude

A DuetWebControl (DWC) plugin that derives TMC stepper-driver chopper/stealthChop settings from motor
specs and writes them to RepRapFirmware (RRF). Vue 3 + Vuetify, built with `dwc-plugin-test-kit`.

## Layout
- `src/model/` — pure logic, unit-tested: `autotune.ts` (formulas), `drivers.ts` (family/register layouts),
  `registers.ts` (bit-field pack/unpack, `M569.2` / `M569 C` formatting), `apply.ts` (register writes +
  config.g block), `machine.ts` (driver discovery, reply parsing), `motorDatabase.ts` (generated — see below).
- `src/DuetTmcTuner.vue` — the whole UI. `src/__tests__/` + `test/` — vitest.
- `scripts/` — release tooling; `update-motors.mjs` syncs the motor DB from upstream (don't hand-edit
  `motorDatabase.ts`).

## How registers are written
- Registers are set directly: read-modify-write via `M569.2 P<d> R<reg> [V<val>]`.
- **CHOPCONF is sent as `M569 P<d> C<n>`** (Apply now and config.g). RRF keeps its own copy of the
  user-settable chopper bits and re-applies it on reprogramming (`M350`, `M569 D`), so raw `M569.2` alone
  is lost. `C` is masked by RRF: 22xx = TOFF/HSTRT/HEND/TBL; TMC2160/5160/2240 add FD3/DISFDCC/TPFD
  (`family.chopperUserFields`; keep in sync with RRF `UserSettableChopConfBits*`). TPFD/FD3/DISFDCC are
  optional overrides (`ChopperExtras`, null = keep live value).
- Always pass `logReply = false` to `machineStore.sendCode(code, false, false)` for programmatic codes —
  otherwise `M569.2` replies pop up as notifications.

## Requirements / gotchas
- Needs RRF **3.7.0-rc.2+** (`M569 C` on CAN expansion boards, the extra CHOPCONF bits). DWC's
  `checkVersion` is prefix-equality, NOT a minimum, so `plugin.json` uses `"rrfVersion": "3.7"`; the RC2
  floor is documented in the README only.
- Release assets: CI publishes `DuetTmcTuner-<ver>.zip` and `-srcmap.zip`. The updater's `assetPattern`
  (`updateCheck.ts`) must only ever match the non-srcmap ZIP. `*.zip` is git-ignored.

## Commands
- `npm test` — vitest. `DWC_DIR=<DuetWebControl checkout> npm run typecheck` / `verify-build`.
- Release: commit everything first (the script requires a clean tree), then
  `npm run release -- <x.y.z> --push` (bumps plugin.json + package.json, tags `v<x.y.z>`; the tag push
  triggers CI). Use Conventional Commits — they generate the release notes.
