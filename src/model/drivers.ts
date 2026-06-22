/**
 * TMC driver families and their register layouts.
 *
 * The CHOPCONF and PWMCONF layouts are identical across the whole TMC220x/222x UART family
 * (TMC2208, TMC2209, TMC2225, TMC2226), so they share one register set and are all tunable today.
 * The SPI families (TMC2160/5160 and TMC2240) use different layouts and are defined as
 * not-yet-supported stubs so the UI can list them and the architecture is ready to fill them in.
 *
 * Register addresses are the decimal `R` values passed to `M569.2` (TMC datasheets give them in hex —
 * the comments note both). Only the fields the autotune touches plus a few for read-back display are
 * declared; unlisted bits are preserved by read-modify-write (see model/registers.ts).
 */
import type { RegisterDef } from "./registers";

export type FamilyId = "tmc22xx" | "tmc5160" | "tmc2240";

export interface DriverFamily {
	id: FamilyId;
	/** Display label for the family. */
	label: string;
	/** Specific chips this family covers (shown in the chip picker). */
	chips: ReadonlyArray<string>;
	/** A representative chip name for auto-detection display, e.g. "TMC2209". */
	defaultChip: string;
	/** Default driver clock (Hz) used by the autotune formulas; user-overridable in the UI. */
	fclk: number;
	/** Default stealthChop PWM frequency target (Hz). 22xx run quiet at 55 kHz; 5160/2240 at 20 kHz. */
	pwmFreqTarget: number;
	/**
	 * Comparator blank time in tCLK cycles for TBL = 0,1,2,3. This differs by family (per Trinamic's
	 * calculation sheets): 220x/222x = 16/24/32/40; 2160/5160/2240/5240 = 16/24/36/54.
	 */
	blankCycles: readonly [number, number, number, number];
	/** CHOPCONF + PWMCONF (the two registers the chopper/PWM autotune writes). */
	registers: { chopconf: RegisterDef; pwmconf: RegisterDef };
	/** TPWMTHRS (stealthChop↔spreadCycle switch). Single 20-bit value in field `value`. */
	tpwmthrs: RegisterDef;
	/** THIGH (→ fullstep) — only the SPI families have it; null otherwise. */
	thigh: RegisterDef | null;
	/** True for chips with an SG4 threshold register (2209/2240) — affects the autoswitch point. */
	hasSg4: boolean;
	/** TCOOLTHRS (lower velocity bound for CoolStep + StallGuard). Single 20-bit value in `value`. */
	tcoolthrs: RegisterDef;
	/** COOLCONF (CoolStep config; also carries SGT on the SPI parts). */
	coolconf: RegisterDef;
	/** How StallGuard's threshold is set on this family. */
	stallGuard: StallGuardSpec;
	/** Whether the tuner can compute + write this family yet. */
	supported: boolean;
}

/** Where/how the StallGuard threshold lives: a dedicated SGTHRS register (22xx) or SGT in COOLCONF (SPI). */
export type StallGuardSpec =
	| { kind: "sgthrs"; register: RegisterDef; default: number; min: number; max: number }
	| { kind: "sgt"; default: number; min: number; max: number };

/** Chips in the 22xx family that lack CoolStep/StallGuard entirely (basic UART parts). */
export const CHIPS_WITHOUT_COOLSTEP: ReadonlySet<string> = new Set(["TMC2208", "TMC2225"]);

/** Whether a chip supports the CoolStep/StallGuard registers (false for plain 2208/2225). */
export function supportsCoolStep(chip: string): boolean {
	return !CHIPS_WITHOUT_COOLSTEP.has(chip.trim().toUpperCase());
}

/** A single-value 20-bit register (TPWMTHRS/THIGH/TCOOLTHRS), stored in field `value`. */
function reg20(name: string, address: number): RegisterDef {
	return { name, address, fields: { value: { bit: 0, width: 20 } } };
}

// CoolStep config. 22xx COOLCONF (0x42) carries only the CoolStep fields; the SPI parts' COOLCONF
// (0x6D) also carries SGT (StallGuard2 threshold, 7-bit signed) and the SFILT bit.
const coolconf22xx: RegisterDef = {
	name: "COOLCONF",
	address: 0x42,
	fields: {
		semin: { bit: 0, width: 4 },
		seup: { bit: 5, width: 2 },
		semax: { bit: 8, width: 4 },
		sedn: { bit: 13, width: 2 },
		seimin: { bit: 15, width: 1 },
	},
};
const coolconf51xx: RegisterDef = {
	name: "COOLCONF",
	address: 0x6D,
	fields: {
		semin: { bit: 0, width: 4 },
		seup: { bit: 5, width: 2 },
		semax: { bit: 8, width: 4 },
		sedn: { bit: 13, width: 2 },
		seimin: { bit: 15, width: 1 },
		sgt: { bit: 16, width: 7 }, // signed −64..63
		sfilt: { bit: 24, width: 1 },
	},
};
const sgthrsReg: RegisterDef = { name: "SGTHRS", address: 0x40, fields: { value: { bit: 0, width: 8 } } };

// ── TMC220x / 222x (UART) — CHOPCONF 0x6C, PWMCONF 0x70 ─────────────────────────────────────────
const tmc22xxChopconf: RegisterDef = {
	name: "CHOPCONF",
	address: 0x6C, // 108
	fields: {
		toff: { bit: 0, width: 4 },
		hstrt: { bit: 4, width: 3, offset: -1 }, // stored = (logical hstrt) − 1
		hend: { bit: 7, width: 4, offset: 3 }, //  stored = (logical hend) + 3
		tbl: { bit: 15, width: 2 },
		vsense: { bit: 17, width: 1 },
		mres: { bit: 24, width: 4 },
		intpol: { bit: 28, width: 1 },
		dedge: { bit: 29, width: 1 },
		diss2g: { bit: 30, width: 1 },
		diss2vs: { bit: 31, width: 1 },
	},
};

// PWMCONF (0x70) has the same layout across TMC220x/222x, TMC2160/5160 and TMC2240, so it is shared.
const sharedPwmconf: RegisterDef = {
	name: "PWMCONF",
	address: 0x70, // 112
	fields: {
		pwm_ofs: { bit: 0, width: 8 },
		pwm_grad: { bit: 8, width: 8 },
		pwm_freq: { bit: 16, width: 2 },
		pwm_autoscale: { bit: 18, width: 1 },
		pwm_autograd: { bit: 19, width: 1 },
		freewheel: { bit: 20, width: 2 },
		pwm_reg: { bit: 24, width: 4 },
		pwm_lim: { bit: 28, width: 4 },
	},
};

// ── TMC2160 / 5160 / 2240 (SPI) — CHOPCONF 0x6C ─────────────────────────────────────────────────
// TOFF/HSTRT/HEND/TBL/MRES sit at the SAME positions as the 22xx family, so the autotuned fields pack
// identically. The differences are CHM (bit 14) and TPFD (bits 20–23) instead of 22xx's VSENSE; the
// tuner leaves CHM/TPFD untouched (read-modify-write) — they're declared for accurate read-back.
const tmc51xxChopconf: RegisterDef = {
	name: "CHOPCONF",
	address: 0x6C, // 108
	fields: {
		toff: { bit: 0, width: 4 },
		hstrt: { bit: 4, width: 3, offset: -1 },
		hend: { bit: 7, width: 4, offset: 3 },
		chm: { bit: 14, width: 1 },
		tbl: { bit: 15, width: 2 },
		tpfd: { bit: 20, width: 4 },
		mres: { bit: 24, width: 4 },
		intpol: { bit: 28, width: 1 },
		dedge: { bit: 29, width: 1 },
		diss2g: { bit: 30, width: 1 },
		diss2vs: { bit: 31, width: 1 },
	},
};

export const DRIVER_FAMILIES: Record<FamilyId, DriverFamily> = {
	tmc22xx: {
		id: "tmc22xx",
		label: "TMC2208 / 2209 / 2225 / 2226",
		chips: ["TMC2208", "TMC2209", "TMC2225", "TMC2226"],
		defaultChip: "TMC2209",
		fclk: 12_000_000, // internal oscillator (datasheet nominal)
		pwmFreqTarget: 55_000,
		blankCycles: [16, 24, 32, 40],
		registers: { chopconf: tmc22xxChopconf, pwmconf: sharedPwmconf },
		tpwmthrs: reg20("TPWMTHRS", 0x13),
		thigh: null, // 22xx has no THIGH register
		hasSg4: true, // 2209 has SG4 (2208 doesn't, but the family default suits the common 2209)
		tcoolthrs: reg20("TCOOLTHRS", 0x14),
		coolconf: coolconf22xx,
		stallGuard: { kind: "sgthrs", register: sgthrsReg, default: 40, min: 0, max: 255 },
		supported: true,
	},
	tmc5160: {
		id: "tmc5160",
		label: "TMC2160 / 5160",
		chips: ["TMC2160", "TMC5160"],
		defaultChip: "TMC5160",
		fclk: 12_000_000, // Duet drives these from a 12 MHz external clock
		pwmFreqTarget: 20_000, // 5160s run hot at high PWM frequency
		blankCycles: [16, 24, 36, 54],
		registers: { chopconf: tmc51xxChopconf, pwmconf: sharedPwmconf },
		tpwmthrs: reg20("TPWMTHRS", 0x13),
		thigh: reg20("THIGH", 0x15),
		hasSg4: false, // 5160 uses SGT, not an SG4 threshold register
		tcoolthrs: reg20("TCOOLTHRS", 0x14),
		coolconf: coolconf51xx,
		stallGuard: { kind: "sgt", default: 1, min: -64, max: 63 },
		supported: true,
	},
	tmc2240: {
		id: "tmc2240",
		label: "TMC2240",
		chips: ["TMC2240"],
		defaultChip: "TMC2240",
		fclk: 12_500_000, // internal oscillator
		pwmFreqTarget: 20_000,
		blankCycles: [16, 24, 36, 54],
		registers: { chopconf: tmc51xxChopconf, pwmconf: sharedPwmconf },
		tpwmthrs: reg20("TPWMTHRS", 0x13),
		thigh: reg20("THIGH", 0x15),
		hasSg4: true,
		tcoolthrs: reg20("TCOOLTHRS", 0x14),
		coolconf: coolconf51xx,
		stallGuard: { kind: "sgt", default: 1, min: -64, max: 63 },
		supported: true,
	},
};

/** Families a user can actually tune right now. */
export function supportedFamilies(): Array<DriverFamily> {
	return Object.values(DRIVER_FAMILIES).filter((f) => f.supported);
}

/** Resolve the family that contains a given chip name (case-insensitive), if any. */
export function familyForChip(chip: string): DriverFamily | undefined {
	const c = chip.trim().toUpperCase();
	return Object.values(DRIVER_FAMILIES).find((f) => f.chips.some((x) => x.toUpperCase() === c));
}
