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
- Read-back: `M569 P<d>` reports `ccr 0x…` = exactly the `M569 C` bits (RC2+); it's the base for those
  bits. M569.2 reads go through one per-driver "special read" slot that can return a stale value from an
  abandoned read (CAN gives up after 50 ms), so reads are done twice (`readFresh`).
- PWMCONF is write-only on TMC2160/5160 → base is RRF's `DefaultPwmConfReg` (`pwmconfDefault`).
- CoolStep/StallGuard go through `M915 P<d> H/T/S`, not raw M569.2: RRF keeps SGT/SFILT inside COOLCONF
  (51xx), tracks the stall speed from H, and maps S to SGTHRS (22xx: SGTHRS = 127 − S), SGT (51xx/2240 SPI)
  or SG4_THRS (2240 on UART, Duet 3 Mini). TPWMTHRS/THIGH stay M569.2 (M569 V/H are 16-bit over CAN).
- `sendCode` resolves with RRF's reply text, it does not throw on `Error:` — check with `replyError`.
  TOFF/TBL/HSTRT+HEND are validated like RRF's `SetChopConf` (else "Bad ccr").
- Always pass `logReply = false` to `machineStore.sendCode(code, false, false)` for programmatic codes —
  otherwise `M569.2` replies pop up as notifications.

## Requirements / gotchas
- Needs RRF **3.7.0-rc.2+** (`M569 C` on CAN expansion boards, the extra CHOPCONF bits). DWC's
  `checkVersion` is prefix-equality, NOT a minimum, so `plugin.json` uses `"rrfVersion": "3.7"`; the RC2
  floor is documented in the README only.
- Release assets: CI publishes only `DuetTmcTuner-<ver>.zip` (glob `*[0-9].zip` skips the build's
  `-srcmap.zip`). The Duet3D PluginRepository checker reads `assets[0]` of the latest release and needs
  `plugin.json` in it, so a srcmap ZIP must never be attached. The updater's `assetPattern`
  (`updateCheck.ts`) still ignores srcmap ZIPs on older releases. `*.zip` is git-ignored.

## Commands
- `npm test` — vitest. `DWC_DIR=<DuetWebControl checkout> npm run typecheck` / `verify-build`.
- Release: commit everything first (the script requires a clean tree), then
  `npm run release -- <x.y.z> --push` (bumps plugin.json + package.json, tags `v<x.y.z>`; the tag push
  triggers CI). Use Conventional Commits — they generate the release notes.
