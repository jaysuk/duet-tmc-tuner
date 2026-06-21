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
	/** Default driver clock (Hz) used by the autotune formulas; user-overridable in the UI. */
	fclk: number;
	/** CHOPCONF + PWMCONF (the two registers the chopper/PWM autotune writes). */
	registers: { chopconf: RegisterDef; pwmconf: RegisterDef };
	/** Whether the tuner can compute + write this family yet. */
	supported: boolean;
}

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

const tmc22xxPwmconf: RegisterDef = {
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

export const DRIVER_FAMILIES: Record<FamilyId, DriverFamily> = {
	tmc22xx: {
		id: "tmc22xx",
		label: "TMC2208 / 2209 / 2225 / 2226",
		chips: ["TMC2208", "TMC2209", "TMC2225", "TMC2226"],
		fclk: 12_000_000, // internal oscillator (datasheet nominal)
		registers: { chopconf: tmc22xxChopconf, pwmconf: tmc22xxPwmconf },
		supported: true,
	},
	// ── Planned: SPI families. Layouts differ (e.g. 5160 CHOPCONF has TPFD/chm bits; PWMCONF adds
	//    PWM_REG/PWM_LIM positions; both add TPOWERDOWN/TPWMTHRS handling). Filled in next. ──────────
	tmc5160: {
		id: "tmc5160",
		label: "TMC2160 / 5160",
		chips: ["TMC2160", "TMC5160"],
		fclk: 12_000_000,
		registers: { chopconf: tmc22xxChopconf, pwmconf: tmc22xxPwmconf }, // placeholder until 5160 map added
		supported: false,
	},
	tmc2240: {
		id: "tmc2240",
		label: "TMC2240",
		chips: ["TMC2240"],
		fclk: 12_500_000,
		registers: { chopconf: tmc22xxChopconf, pwmconf: tmc22xxPwmconf }, // placeholder until 2240 map added
		supported: false,
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
