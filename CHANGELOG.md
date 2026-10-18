# Changelog

Release notes for each version. The GitHub Release body for a version is taken from its section here, so
write (or draft with `draft-release-notes.mjs`) the section before tagging. The generated commit list is
kept collapsed under it on the release page.

## [1.2.0] - 2026-10-18

This release makes **applying driver settings reliable on RepRapFirmware 3.7.0**. Every command the plugin sends has been checked against RRF 3.7.0. If the firmware rejects a setting, you now get an error instead of a false success, and several register settings that could be wrong on some driver chips are fixed.

### 🐛 Fixed

- **Apply no longer reports success when the firmware rejects a setting:** The plugin now checks each reply from RRF. It stops at the first error and shows you RRF's own message, so you know the driver didn't get the new values.
- **No more "Bad ccr" errors from chopper settings:** `TOFF`, `TBL` and `HSTRT`/`HEND` are now checked using the same rules RRF uses before `M569 C` is sent. Values RRF would refuse are caught before they reach the printer.
- **Correct PWM settings on TMC2160 and TMC5160:** These chips don't let `PWMCONF` be read back, so the plugin was building on a meaningless value. It now starts from RRF's default PWM configuration, so you don't get unexpected bits in what's written to the driver.
- **More accurate read-back of driver registers:** On RRF 3.7.0-rc.2 and later, the chopper settings shown come from what `M569` reports. Registers read with `M569.2` are read twice so you don't see an out-of-date value. Error replies are no longer shown as if they were register values.
- **StallGuard help text:** The help now says which way to move the threshold to change sensitivity.
- **Plugin repository listing:** Each release now includes only the plugin ZIP, so the Duet3D plugin repository can find and list new versions correctly.

### ⚠️ Changed

- **CoolStep and StallGuard are now applied with `M915`:** These settings are sent with `M915` using the `H`, `T` and `S` parameters. This means RRF keeps its own StallGuard threshold, filter and stall speed in sync and maps the threshold onto the chip's own register. That includes the TMC2240 on the Duet 3 Mini. Because the settings now go through RRF's stall detection, applying them from the plugin also changes what `M915` reports for that driver.
