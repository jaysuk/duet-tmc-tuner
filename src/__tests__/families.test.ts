import { describe, expect, it } from "vitest";

import { computeAutotune } from "../model/autotune";
import { buildRegisterWrites } from "../model/apply";
import { DRIVER_FAMILIES, familyForChip, supportedFamilies } from "../model/drivers";

describe("driver families", () => {
	it("supports the STM32-port TMC families (22xx, 5160/2160, 2240)", () => {
		const ids = supportedFamilies().map((f) => f.id).sort();
		expect(ids).toEqual(["tmc2240", "tmc22xx", "tmc5160"]);
	});

	it("uses 55 kHz PWM target for 22xx and 20 kHz for the hot SPI families", () => {
		expect(DRIVER_FAMILIES.tmc22xx.pwmFreqTarget).toBe(55_000);
		expect(DRIVER_FAMILIES.tmc5160.pwmFreqTarget).toBe(20_000);
		expect(DRIVER_FAMILIES.tmc2240.pwmFreqTarget).toBe(20_000);
	});

	it("maps chips to the right family", () => {
		expect(familyForChip("TMC2209")?.id).toBe("tmc22xx");
		expect(familyForChip("tmc5160")?.id).toBe("tmc5160");
		expect(familyForChip("TMC2240")?.id).toBe("tmc2240");
	});

	it("keeps CHOPCONF/PWMCONF at the standard addresses for every family", () => {
		for (const f of supportedFamilies()) {
			expect(f.registers.chopconf.address).toBe(0x6C);
			expect(f.registers.pwmconf.address).toBe(0x70);
		}
	});

	it("packs the same TOFF/HSTRT/HEND/TBL bit positions across families (5160 example)", () => {
		const motor = { resistance: 1.5, inductance: 0.0015, holdingTorque: 0.45, maxCurrent: 2, stepsPerRev: 200 };
		const r = computeAutotune(motor, { volts: 24, fclk: DRIVER_FAMILIES.tmc5160.fclk, pwmFreqTargetHz: DRIVER_FAMILIES.tmc5160.pwmFreqTarget });
		const writes = buildRegisterWrites(DRIVER_FAMILIES.tmc5160, "0.0", r, {});
		const chop = writes.find((w) => w.register === "CHOPCONF")!;
		// TOFF in bits 0..3 should equal the computed toff (default 3).
		expect(chop.word & 0xF).toBe(r.chopconf.toff);
		expect(chop.command).toMatch(/^M569\.2 P0\.0 R108 V\d+$/);
	});
});
