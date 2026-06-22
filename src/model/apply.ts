/**
 * Turn an autotune result into the actual `M569.2` register writes for a given driver, using
 * read-modify-write so only the autotuned fields change and RRF's own bits (microstep resolution,
 * vsense/current, interpolation, …) are preserved.
 *
 * `current` holds the live register words read back from the board (`M569.2 P<d> R<reg>`); when it's
 * absent we start from 0, which is only safe for preview — accurate writes need a board read first so
 * the preserved bits are real. The UI enforces that.
 */
import { type AutotuneResult, type ThresholdResult, tstepFromRevsPerSec } from "./autotune";
import type { DriverFamily } from "./drivers";
import { applyFields, encodeFields, toM569_2Read, toM569_2Write } from "./registers";

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

export interface RegisterWrite {
	/** Register name, e.g. "CHOPCONF". */
	register: string;
	/** Decimal register address (the `R` value). */
	address: number;
	/** Full 32-bit word to write (unsigned). */
	word: number;
	/** The ready-to-send `M569.2` command. */
	command: string;
}

/** Live register words read back from the board, keyed by register name we care about. */
export interface CurrentRegisters {
	chopconf?: number;
	pwmconf?: number;
}

/** Build the `M569.2` reads needed to capture the registers this tuner will modify. */
export function buildReadCommands(family: DriverFamily, driver: string | number): Array<string> {
	return [
		toM569_2Read(driver, family.registers.chopconf),
		toM569_2Read(driver, family.registers.pwmconf),
	];
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
): Array<RegisterWrite> {
	const chop = family.registers.chopconf;
	const pwm = family.registers.pwmconf;

	const chopWord = applyFields(chop, current.chopconf ?? 0, result.chopconf);
	const pwmWord = applyFields(pwm, current.pwmconf ?? 0, result.pwmconf as unknown as Record<string, number>);

	const writes: Array<RegisterWrite> = [
		{ register: chop.name, address: chop.address, word: chopWord, command: toM569_2Write(driver, chop, chopWord) },
		{ register: pwm.name, address: pwm.address, word: pwmWord, command: toM569_2Write(driver, pwm, pwmWord) },
	];
	const push = (reg: typeof chop, word: number) =>
		writes.push({ register: reg.name, address: reg.address, word, command: toM569_2Write(driver, reg, word) });

	if (thresholds && thresholds.tpwmthrs !== null) {
		push(family.tpwmthrs, encodeFields(family.tpwmthrs, { value: thresholds.tpwmthrs }));
	}
	if (thresholds && thresholds.thigh !== null && family.thigh) {
		push(family.thigh, encodeFields(family.thigh, { value: thresholds.thigh }));
	}

	// CoolStep + StallGuard (opt-in). TCOOLTHRS gates both; COOLCONF carries the CoolStep fields (and
	// SGT on the SPI parts); 22xx StallGuard uses the separate SGTHRS register.
	if (advanced && (advanced.coolStep || advanced.stallGuard)) {
		const sg = family.stallGuard;
		push(family.tcoolthrs, encodeFields(family.tcoolthrs, { value: tstepFromRevsPerSec(advanced.fclk, advanced.stepsPerRev, COOLSTEP_THRS_REVS) }));

		const needCoolconf = advanced.coolStep || (advanced.stallGuard && sg.kind === "sgt");
		if (needCoolconf) {
			const f: Record<string, number> = {};
			if (advanced.coolStep) {
				const d = { ...COOLSTEP_DEFAULTS, ...advanced.coolStepFields };
				Object.assign(f, { semin: d.semin, semax: d.semax, seup: d.seup, sedn: d.sedn, seimin: d.seimin });
			}
			if (advanced.stallGuard && sg.kind === "sgt") {
				f.sgt = advanced.sgValue; // encodeFields handles the 7-bit signed two's-complement
			}
			push(family.coolconf, encodeFields(family.coolconf, f));
		}
		if (advanced.stallGuard && sg.kind === "sgthrs") {
			push(sg.register, encodeFields(sg.register, { value: advanced.sgValue }));
		}
	}

	return writes;
}

/**
 * Render a config.g-ready block: a header comment naming the motor/driver, then the writes. Place it
 * AFTER the driver setup (M569 / M906 / microstepping) in config.g so RRF doesn't overwrite it.
 */
export function buildConfigBlock(
	writes: Array<RegisterWrite>,
	meta: { driver: string | number; chip: string; motor?: string; volts: number },
): string {
	const lines = [
		`; Duet TMC Tuner — driver ${meta.driver} (${meta.chip})${meta.motor ? `, ${meta.motor}` : ""}, ${meta.volts} V`,
		"; Apply after the driver's M569 / M906 / microstepping setup.",
		...writes.map((w) => `${w.command}    ; ${w.register} = 0x${(w.word >>> 0).toString(16).toUpperCase().padStart(8, "0")}`),
	];
	return lines.join("\n");
}
