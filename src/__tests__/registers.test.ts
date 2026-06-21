import { describe, expect, it } from "vitest";

import { computeAutotune } from "../model/autotune";
import { buildRegisterWrites } from "../model/apply";
import { DRIVER_FAMILIES } from "../model/drivers";
import { applyFields, decodeFields, encodeFields, toM569_2Write } from "../model/registers";

const chop = DRIVER_FAMILIES.tmc22xx.registers.chopconf;
const pwm = DRIVER_FAMILIES.tmc22xx.registers.pwmconf;

describe("register encode/decode", () => {
	it("packs CHOPCONF fields at the right bit positions", () => {
		// toff=3, hend(stored)=1 -> bit7, tbl=1 -> bit15
		expect(encodeFields(chop, { toff: 3, hstrt: 0, hend: 1, tbl: 1 })).toBe(0x8083);
	});

	it("round-trips through decode", () => {
		const word = encodeFields(chop, { toff: 5, hstrt: 4, hend: 2, tbl: 2, mres: 8, vsense: 1 });
		const f = decodeFields(chop, word);
		expect(f.toff).toBe(5);
		expect(f.hstrt).toBe(4);
		expect(f.hend).toBe(2);
		expect(f.tbl).toBe(2);
		expect(f.mres).toBe(8);
		expect(f.vsense).toBe(1);
	});

	it("read-modify-write preserves untouched bits (mres, vsense)", () => {
		// Current word: mres=8 (1/256 microstepping) + vsense=1, nothing else.
		const current = encodeFields(chop, { mres: 8, vsense: 1 });
		const out = applyFields(chop, current, { toff: 3, hstrt: 0, hend: 1, tbl: 1 });
		const f = decodeFields(chop, out);
		expect(f.mres).toBe(8); // preserved
		expect(f.vsense).toBe(1); // preserved
		expect(f.toff).toBe(3); // applied
		expect(f.tbl).toBe(1);
		expect(f.hend).toBe(1);
	});

	it("handles bit-31 fields without sign issues", () => {
		const word = encodeFields(pwm, { pwm_lim: 0xF }); // top nibble -> bit 28..31
		expect(word >>> 0).toBe(0xF0000000);
		expect(decodeFields(pwm, word).pwm_lim).toBe(0xF);
	});

	it("emits decimal address + unsigned value for M569.2", () => {
		expect(toM569_2Write("0.0", chop, 0x8083)).toBe("M569.2 P0.0 R108 V32899");
	});
});

describe("end-to-end: reference motor -> M569.2 writes (from a zero base)", () => {
	const r = computeAutotune(
		{ resistance: 6.5, inductance: 0.013, holdingTorque: 0.49, maxCurrent: 1, stepsPerRev: 200 },
		{ volts: 24, fclk: 12_500_000 },
	);
	const writes = buildRegisterWrites(DRIVER_FAMILIES.tmc22xx, "0.0", r, {});

	it("produces the expected CHOPCONF and PWMCONF words/commands", () => {
		const chopW = writes.find((w) => w.register === "CHOPCONF")!;
		const pwmW = writes.find((w) => w.register === "PWMCONF")!;
		expect(chopW.word >>> 0).toBe(0x8083); // 32899
		expect(chopW.command).toBe("M569.2 P0.0 R108 V32899");
		expect(pwmW.word >>> 0).toBe(0xE1766); // ofs 102, grad 23, freq 2, autoscale+autograd
		expect(pwmW.command).toBe("M569.2 P0.0 R112 V923494");
	});

	it("read-modify-write keeps live mres/current bits while changing the tuned fields", () => {
		const current = { chopconf: encodeFields(chop, { mres: 8, vsense: 1, toff: 5 }), pwmconf: 0 };
		const rmw = buildRegisterWrites(DRIVER_FAMILIES.tmc22xx, "0.0", r, current);
		const f = decodeFields(chop, rmw.find((w) => w.register === "CHOPCONF")!.word);
		expect(f.mres).toBe(8);
		expect(f.vsense).toBe(1);
		expect(f.toff).toBe(3); // overwritten by the tune
	});
});
