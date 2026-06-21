import { describe, expect, it } from "vitest";

import { MOTOR_DATABASE } from "../model/motorDatabase";
import { computeAutotune } from "../model/autotune";

describe("motor database", () => {
	it("includes the full set of motors", () => {
		expect(MOTOR_DATABASE.length).toBeGreaterThanOrEqual(200);
	});

	it("has unique ids", () => {
		const ids = new Set(MOTOR_DATABASE.map((m) => m.id));
		expect(ids.size).toBe(MOTOR_DATABASE.length);
	});

	it("every entry has positive, finite electrical specs", () => {
		for (const m of MOTOR_DATABASE) {
			for (const v of [m.resistance, m.inductance, m.holdingTorque, m.maxCurrent, m.stepsPerRev]) {
				expect(Number.isFinite(v)).toBe(true);
				expect(v).toBeGreaterThan(0);
			}
			expect([200, 400]).toContain(m.stepsPerRev);
		}
	});

	it("every entry produces in-range register fields (no NaN, fields fit their widths)", () => {
		for (const m of MOTOR_DATABASE) {
			const r = computeAutotune(m, { volts: 24, fclk: 12_000_000 });
			expect(Number.isFinite(r.pwmgrad)).toBe(true);
			expect(r.pwmconf.pwm_ofs).toBeGreaterThanOrEqual(0);
			expect(r.pwmconf.pwm_ofs).toBeLessThanOrEqual(255);
			expect(r.pwmconf.pwm_grad).toBeGreaterThanOrEqual(0);
			expect(r.pwmconf.pwm_grad).toBeLessThanOrEqual(255);
			expect(r.chopconf.toff).toBeGreaterThanOrEqual(1);
			expect(r.chopconf.hstrt).toBeGreaterThanOrEqual(0);
			expect(r.chopconf.hstrt).toBeLessThanOrEqual(7);
			expect(r.chopconf.hend).toBeGreaterThanOrEqual(0);
			expect(r.chopconf.hend).toBeLessThanOrEqual(15);
		}
	});
});
