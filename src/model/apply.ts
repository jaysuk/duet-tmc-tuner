/**
 * Turn an autotune result into the commands that program a given driver, using read-modify-write so
 * only the autotuned fields change and RRF's own bits (microstep resolution, vsense/current,
 * interpolation, …) are preserved.
 *
 * Where RRF keeps its own copy of a register and re-applies it, the write goes through the RRF code
 * that owns that copy (a raw `M569.2` write would be overwritten or leave RRF's state stale):
 *   - CHOPCONF user bits → `M569 P<d> C<n>` (RRF re-applies them on M350 / M569 D / driver enable).
 *   - TCOOLTHRS / COOLCONF / SGTHRS → `M915 P<d> H/T/S` (RRF also tracks the stall speed, keeps SGT and
 *     SFILT inside COOLCONF, and maps S onto whichever threshold register the chip uses).
 * PWMCONF, TPWMTHRS and THIGH are only set by RRF at start-up (or by M569 V/H, which are 16-bit over
 * CAN), so they are written raw with `M569.2`; RRF stores those writes in its register shadow.
 *
 * `current` holds what was read back from the board; before a read the preview starts from 0 / RRF's
 * defaults, which is why the UI requires a read before Apply.
 */
import type { AutotuneResult, ThresholdResult } from "./autotune";
import type { DriverFamily } from "./drivers";
import { applyFields, decodeFields, encodeFields, fieldsMask, toM569_2Read, toM569_2Write, toM569CWrite } from "./registers";

/** Klipper's CoolStep defaults (COOLCONF fields). */
export const COOLSTEP_DEFAULTS = { semin: 2, semax: 4, seup: 3, sedn: 2, seimin: 1 } as const;

/** Lower velocity (rev/s) above which CoolStep + StallGuard operate (→ TCOOLTHRS). */
const COOLSTEP_THRS_REVS = 0.75;

/** Optional CoolStep / StallGuard plan; when present, the matching registers are also written. */
export interface AdvancedPlan {
	coolStep: boolean;
	stallGuard: boolean;
	fclk: number;
	stepsPerRev: number;
	/** StallGuard threshold: SGTHRS 0–255 on 22xx, or SGT −64..63 on the SPI parts. */
	sgValue: number;
	/** CoolStep field overrides (defaults from COOLSTEP_DEFAULTS). */
	coolStepFields?: Partial<typeof COOLSTEP_DEFAULTS>;
}

/**
 * Optional CHOPCONF bits set through `M569 C` (RRF 3.7.0-rc.2+; TMC2160/5160/2240 only). `null`/absent
 * keeps whatever RRF currently holds; families without the field ignore it.
 */
export interface ChopperExtras {
	/** Passive fast decay time, 0–15 (TPFD) — damps mid-range resonance. */
	tpfd?: number | null;
	/** MSB of the fast decay time (FD3), 0/1. */
	fd3?: number | null;
	/** Disable current-comparator termination of fast decay (DISFDCC), 0/1. */
	disfdcc?: number | null;
}

export interface RegisterWrite {
	/** Register name, e.g. "CHOPCONF". */
	register: string;
	/** Decimal register address (the `R` value). */
	address: number;
	/** Full 32-bit word the register ends up holding (unsigned). */
	word: number;
	/** The equivalent raw `M569.2` write. */
	command: string;
	/**
	 * The RRF-managed command that Apply now and config.g send instead of `command`, for registers RRF
	 * keeps its own copy of: `M569 P<d> C<n>` for CHOPCONF, `M915 P<d> …` for TCOOLTHRS/COOLCONF/SGTHRS.
	 */
	rrfCommand?: string;
}

/** The command Apply now and config.g send for a write. */
export function commandFor(w: RegisterWrite): string {
	return w.rrfCommand ?? w.command;
}

/** What was read back from the board for the registers this tuner modifies. */
export interface CurrentRegisters {
	/** Live CHOPCONF word (`M569.2` read). */
	chopconf?: number;
	/** Live PWMCONF word (`M569.2` read; not readable on TMC2160/5160). */
	pwmconf?: number;
	/** RRF's stored user-settable CHOPCONF bits — the `ccr` value that `M569 P<d>` reports. */
	ccr?: number;
}

/** The reads needed to capture the registers this tuner will modify. */
export interface ReadCommands {
	/** `M569 P<d>`: its report carries `ccr`, RRF's own copy of the bits `M569 C` sets. */
	report: string;
	chopconf: string;
	/** Null when PWMCONF is write-only on this family. */
	pwmconf: string | null;
}

export function buildReadCommands(family: DriverFamily, driver: string | number): ReadCommands {
	return {
		report: `M569 P${driver}`,
		chopconf: toM569_2Read(driver, family.registers.chopconf),
		pwmconf: family.pwmconfReadable ? toM569_2Read(driver, family.registers.pwmconf) : null,
	};
}

/**
 * Check TOFF/TBL the way RRF's `SetChopConf` does: an `M569 C` that fails it is rejected with
 * "Bad ccr". Returns a message, or null when the values are acceptable.
 */
export function chopperSettingsError(toff: number, tbl: number): string | null {
	if (!Number.isInteger(toff) || toff < 1 || toff > 15) return "TOFF must be a whole number from 1 to 15.";
	if (!Number.isInteger(tbl) || tbl < 0 || tbl > 3) return "TBL must be a whole number from 0 to 3.";
	if (toff === 1 && tbl < 2) return "TOFF 1 needs TBL 2 or 3 (RRF rejects it otherwise).";
	return null;
}

/** RRF's `SetChopConf` check on a final CHOPCONF word; null when RRF will accept it via `M569 C`. */
export function chopperWordError(family: DriverFamily, word: number): string | null {
	const f = decodeFields(family.registers.chopconf, word);
	if (f.toff === 0 || (f.toff === 1 && f.tbl < 2)) return "CHOPCONF has an invalid TOFF/TBL combination.";
	if (f.hstrt + f.hend > 16) return "CHOPCONF HSTRT + HEND is too large for RRF.";
	return null;
}

/** RRF's TCOOLTHRS for `M915 H<fullsteps/s>` (`SetStallMinimumStepsPerSecond`). */
function tcoolthrsFromFullSteps(fclk: number, fullStepsPerSec: number): number {
	return Math.min(0xFFFFF, Math.floor((fclk + 128 * fullStepsPerSec) / (256 * fullStepsPerSec)));
}

/**
 * Build the register writes: CHOPCONF + PWMCONF (read-modify-write over `current`), plus the velocity
 * thresholds TPWMTHRS/THIGH when `thresholds` is supplied (a chosen tuning mode). The threshold
 * registers are single-value, so they're written whole.
 */
export function buildRegisterWrites(
	family: DriverFamily,
	driver: string | number,
	result: AutotuneResult,
	current: CurrentRegisters = {},
	thresholds?: ThresholdResult,
	advanced?: AdvancedPlan,
	extras?: ChopperExtras,
): Array<RegisterWrite> {
	const chop = family.registers.chopconf;
	const pwm = family.registers.pwmconf;
	const userMask = fieldsMask(chop, family.chopperUserFields);

	const chopFields: Record<string, number> = { ...result.chopconf };
	for (const [name, value] of Object.entries(extras ?? {})) {
		if (value !== null && value !== undefined && family.chopperUserFields.includes(name)) {
			chopFields[name] = value;
		}
	}
	// RRF's stored chopper bits (M569 ccr) win over the live read for the bits M569 C replaces.
	let chopBase = current.chopconf ?? 0;
	if (current.ccr !== undefined) {
		chopBase = ((chopBase & ~userMask) | (current.ccr & userMask)) >>> 0;
	}
	const chopWord = applyFields(chop, chopBase, chopFields);
	// PWMCONF is write-only on the 2160/5160; RRF writes its default at start-up and never changes it.
	const pwmBase = family.pwmconfReadable ? current.pwmconf ?? family.pwmconfDefault : family.pwmconfDefault;
	const pwmWord = applyFields(pwm, pwmBase, result.pwmconf as unknown as Record<string, number>);

	const writes: Array<RegisterWrite> = [
		{
			register: chop.name, address: chop.address, word: chopWord, command: toM569_2Write(driver, chop, chopWord),
			rrfCommand: toM569CWrite(driver, chopWord & userMask),
		},
		{ register: pwm.name, address: pwm.address, word: pwmWord, command: toM569_2Write(driver, pwm, pwmWord) },
	];
	const push = (reg: typeof chop, word: number, rrfCommand?: string) =>
		writes.push({ register: reg.name, address: reg.address, word, command: toM569_2Write(driver, reg, word), rrfCommand });

	if (thresholds && thresholds.tpwmthrs !== null) {
		push(family.tpwmthrs, encodeFields(family.tpwmthrs, { value: thresholds.tpwmthrs }));
	}
	if (thresholds && thresholds.thigh !== null && family.thigh) {
		push(family.thigh, encodeFields(family.thigh, { value: thresholds.thigh }));
	}

	// CoolStep + StallGuard (opt-in), all through M915 so RRF keeps the values it manages itself.
	// TCOOLTHRS gates both; COOLCONF carries the CoolStep fields (and SGT on the SPI parts); 22xx
	// StallGuard uses the separate SGTHRS register.
	if (advanced && (advanced.coolStep || advanced.stallGuard)) {
		const sg = family.stallGuard;
		const sgValue = Math.min(sg.max, Math.max(sg.min, Math.round(advanced.sgValue)));
		const fullSteps = Math.max(1, Math.round(advanced.stepsPerRev * COOLSTEP_THRS_REVS));
		push(family.tcoolthrs, encodeFields(family.tcoolthrs, { value: tcoolthrsFromFullSteps(advanced.fclk, fullSteps) }),
			`M915 P${driver} H${fullSteps}`);

		const needCoolconf = advanced.coolStep || (advanced.stallGuard && sg.kind === "sgt");
		if (needCoolconf) {
			const f: Record<string, number> = {};
			const params: Array<string> = [];
			if (advanced.stallGuard && sg.kind === "sgt") {
				f.sgt = sgValue; // encodeFields handles the 7-bit signed two's-complement
				params.push(`S${sgValue}`); // RRF M915 S = SGT on the SPI parts
			}
			if (advanced.coolStep) {
				const d = { ...COOLSTEP_DEFAULTS, ...advanced.coolStepFields };
				Object.assign(f, { semin: d.semin, semax: d.semax, seup: d.seup, sedn: d.sedn, seimin: d.seimin });
				// M915 T sets COOLCONF's low 16 bits (the CoolStep fields) and leaves SGT/SFILT alone.
				params.push(`T${encodeFields(family.coolconf, f) & 0xFFFF}`);
			}
			push(family.coolconf, encodeFields(family.coolconf, f), `M915 P${driver} ${params.join(" ")}`);
		}
		if (advanced.stallGuard && sg.kind === "sgthrs") {
			// RRF maps M915 S −128..127 onto SGTHRS 255..0 (SGTHRS = 127 − S).
			push(sg.register, encodeFields(sg.register, { value: sgValue }), `M915 P${driver} S${127 - sgValue}`);
		}
	}

	return writes;
}

/**
 * Render a config.g-ready block: a header comment naming the motor/driver, then the writes. Place it
 * AFTER the driver setup (M569 / M906 / microstepping / M915) in config.g so RRF doesn't overwrite it.
 */
export function buildConfigBlock(
	writes: Array<RegisterWrite>,
	meta: { driver: string | number; chip: string; motor?: string; volts: number },
): string {
	const lines = [
		`; Duet TMC Tuner — driver ${meta.driver} (${meta.chip})${meta.motor ? `, ${meta.motor}` : ""}, ${meta.volts} V`,
		"; Apply after the driver's M569 / M906 / microstepping / M915 setup.",
		// CHOPCONF goes through M569 C: RRF retains it, so later M350 / M569 D changes keep the tuning (RRF 3.7.0-rc.2+).
		...writes.map((w) => `${commandFor(w)}    ; ${w.register} = 0x${(w.word >>> 0).toString(16).toUpperCase().padStart(8, "0")}`),
	];
	return lines.join("\n");
}
