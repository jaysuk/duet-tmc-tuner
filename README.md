# Duet TMC Tuner — DuetWebControl plugin

Computes quiet **stealthChop** chopper and PWM register values for TMC stepper drivers from a motor's
electrical specs, and writes them **directly to the driver registers** using RepRapFirmware's
`M569.2` — no firmware-specific shortcut codes.

Pick a motor (from a built-in database of 200+ motors, or enter the specs by hand), confirm the
driver, supply voltage and clock, and the plugin derives **CHOPCONF** (TOFF / TBL / HSTRT / HEND) and
**PWMCONF** (PWM_OFS / PWM_GRAD / pwm_freq + autoscale/autograd) using the Trinamic datasheet
initial-value equations. It then:

- shows the computed register words **and their decoded fields** (nothing is applied blind),
- **reads the live registers** off the board first, so a write only changes the tuned fields and your
  microstep-resolution / current / interpolation bits are preserved (read-modify-write),
- **Apply now** sends the `M569.2` writes for an instant tuning session, and
- **Copy for config.g** gives you a ready block to paste *after* your driver setup so it persists.

A Duet Web Control **3.7** plugin (Vue 3 / Vuetify 4).

## Requirements & scope

- A **Duet 3** board whose drivers are **TMC2208 / 2209 / 2225 / 2226** (these share one register
  layout). `M569.2` register access is supported on Duet 3 main + expansion boards from RRF 3.3/3.4.
- Support for the SPI families **TMC2160 / 5160** and **TMC2240** is planned — the architecture is in
  place (per-family register maps); they're listed but not yet selectable.
- A motor datasheet (or a database match) for resistance, inductance, holding torque, rated current
  and steps/rev.

> ⚠️ Direct register writes are powerful. Always review the decoded values, test at low speed, and keep
> a copy of your working config. RRF programs these registers itself from `M569`/`M906`/microstepping,
> so the config.g block must go **after** that setup.

## Develop

Uses [`dwc-plugin-test-kit`](https://github.com/jaysuk/dwc-plugin-test-kit) (typecheck/tests/CI) and
[`dwc-plugin-runtime`](https://github.com/jaysuk/dwc-plugin-runtime) (self-update + diagnostics).

```bash
npm install
npm test
DWC_DIR=/path/to/DuetWebControl npm run typecheck
DWC_DIR=/path/to/DuetWebControl npm run verify-build
```

The autotune maths is unit-tested against a known-good reference output. Releases: `npm run release --
<version> --push`.

## License

GPL-3.0-or-later.
