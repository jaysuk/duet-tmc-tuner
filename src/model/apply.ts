/**
 * Turn an autotune result into the actual `M569.2` register writes for a given driver, using
 * read-modify-write so only the autotuned fields change and RRF's own bits (microstep resolution,
 * vsense/current, interpolation, …) are preserved.
 *
 * `current` holds the live register words read back from the board (`M569.2 P<d> R<reg>`); when it's
 * absent we start from 0, which is only safe for preview — accurate writes need a board read first so
 * the preserved bits are real. The UI enforces that.
 */
import type { AutotuneResult, ThresholdResult } from "./autotune";
import type { DriverFamily } from "./drivers";
import { applyFields, encodeFields, toM569_2Read, toM569_2Write } from "./registers";

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
): Array<RegisterWrite> {
	const chop = family.registers.chopconf;
	const pwm = family.registers.pwmconf;

	const chopWord = applyFields(chop, current.chopconf ?? 0, result.chopconf);
	const pwmWord = applyFields(pwm, current.pwmconf ?? 0, result.pwmconf as unknown as Record<string, number>);

	const writes: Array<RegisterWrite> = [
		{ register: chop.name, address: chop.address, word: chopWord, command: toM569_2Write(driver, chop, chopWord) },
		{ register: pwm.name, address: pwm.address, word: pwmWord, command: toM569_2Write(driver, pwm, pwmWord) },
	];

	if (thresholds && thresholds.tpwmthrs !== null) {
		const word = encodeFields(family.tpwmthrs, { value: thresholds.tpwmthrs });
		writes.push({ register: family.tpwmthrs.name, address: family.tpwmthrs.address, word, command: toM569_2Write(driver, family.tpwmthrs, word) });
	}
	if (thresholds && thresholds.thigh !== null && family.thigh) {
		const word = encodeFields(family.thigh, { value: thresholds.thigh });
		writes.push({ register: family.thigh.name, address: family.thigh.address, word, command: toM569_2Write(driver, family.thigh, word) });
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
