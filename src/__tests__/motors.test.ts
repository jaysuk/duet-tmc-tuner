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

	it("every entry has a non-empty vendor", () => {
		for (const m of MOTOR_DATABASE) {
			expect(m.vendor.trim()).not.toBe("");
		}
	});

	it("has no case-variant duplicate vendors", () => {
		// "Fysetc" alongside "FYSETC" would split one manufacturer into two groups in the picker.
		const byLower = new Map<string, string>();
		for (const m of MOTOR_DATABASE) {
			const seen = byLower.get(m.vendor.toLowerCase());
			if (seen) expect(seen).toBe(m.vendor);
			else byLower.set(m.vendor.toLowerCase(), m.vendor);
		}
	});

	it("labels motors by their own brand, not the upstream section they happen to sit in", () => {
		// Upstream files motors under loose "### Vendor ###" headings that often disagree with the motor:
		// flsun/honeybadger/orientalmotor entries live in the Bondtech section, and the ldo-42sth60 family
		// sits under an unterminated heading that used to leak the previous section's vendor.
		const vendorOf = (id: string) => MOTOR_DATABASE.find((m) => m.id === id)?.vendor;
		expect(vendorOf("flsun-v400-42")).toBe("FLSun");
		expect(vendorOf("honeybadger-42hs48-25044a")).toBe("Honey Badger");
		expect(vendorOf("orientalmotor-PKP245D23A")).toBe("Oriental Motor");
		expect(vendorOf("ldo-42sth60-3004ah")).toBe("LDO");
		expect(vendorOf("zyltech-17hd48002h-22b")).toBe("Zyltech");
	});

	it("gives every recognised brand prefix a vendor matching that prefix", () => {
		// Guards the generator's id-prefix rule: a motor whose id starts with a known brand must not be
		// filed under a different manufacturer.
		const prefixToVendor: Record<string, string> = {
			bondtech: "Bondtech", creality: "Creality", flsun: "FLSun", fysetc: "FYSETC",
			ldo: "LDO", moons: "Moons", motech: "Motech", omc: "StepperOnline",
			oukeda: "Oukeda", qidi: "QIDI", siboor: "Siboor", tmc: "Trinamic", wantai: "Wantai",
		};
		for (const m of MOTOR_DATABASE) {
			const expected = prefixToVendor[m.id.split("-")[0].toLowerCase()];
			if (expected) expect(`${m.id} -> ${m.vendor}`).toBe(`${m.id} -> ${expected}`);
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
