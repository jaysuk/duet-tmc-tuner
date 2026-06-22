import { describe, expect, it } from "vitest";

import { computeAutotune, computeThresholds, selectPwmFreq, tstepFromRevsPerSec } from "../model/autotune";

// Reference motor + conditions from the validated RRF meta-gcode (R 6.5Ω, L 13mH, T 0.49Nm, I 1A,
// 200 steps, 24 V, fCLK 12.5 MHz). The expected intermediate values are the macro's printed output.
const REF_MOTOR = { resistance: 6.5, inductance: 0.013, holdingTorque: 0.49, maxCurrent: 1, stepsPerRev: 200 };
const REF_OPTS = { volts: 24, fclk: 12_500_000 };

describe("computeAutotune (parity with the reference macro)", () => {
	const r = computeAutotune(REF_MOTOR, REF_OPTS);

	it("matches the published intermediate values", () => {
		expect(r.cbemf).toBeCloseTo(0.245, 6);
		expect(r.pwmgrad).toBe(23);
		expect(r.pwmofs).toBe(102);
		expect(r.maxpwmrps).toBeCloseTo(2.117453, 5);
		expect(r.tblank).toBeCloseTo(1.92e-6, 12);
		expect(r.tsd).toBeCloseTo(8.64e-6, 12);
		expect(r.dcoilblank).toBeCloseTo(0.003544615, 8);
		expect(r.dcoilsd).toBeCloseTo(0.008639999, 8);
		expect(r.hstartmin).toBe(-1);
		expect(r.hstrt).toBe(1);
		expect(r.hend).toBe(-2);
	});

	it("packs the stored CHOPCONF field values (hstrt−1, hend+3)", () => {
		expect(r.chopconf).toEqual({ toff: 3, tbl: 1, hstrt: 0, hend: 1 });
	});

	it("packs the PWMCONF field values with autoscale + autograd on", () => {
		expect(r.pwmconf.pwm_ofs).toBe(102);
		expect(r.pwmconf.pwm_grad).toBe(23);
		expect(r.pwmconf.pwm_autoscale).toBe(1);
		expect(r.pwmconf.pwm_autograd).toBe(1);
		expect(r.pwmconf.pwm_freq).toBe(2); // 12.5 MHz · 2/512 = 48.8 kHz ≤ 55 kHz target
	});

	it("clamps PWM_OFS/PWM_GRAD into the 8-bit field range", () => {
		// A very low-resistance, high-torque motor would overflow without clamping.
		const big = computeAutotune({ resistance: 50, inductance: 0.02, holdingTorque: 5, maxCurrent: 1, stepsPerRev: 200 }, REF_OPTS);
		expect(big.pwmconf.pwm_ofs).toBeLessThanOrEqual(255);
		expect(big.pwmconf.pwm_grad).toBeLessThanOrEqual(255);
	});
});

describe("family-specific blank time (Trinamic calc sheets)", () => {
	const m = { resistance: 4.5, inductance: 0.0075, holdingTorque: 0.4, maxCurrent: 2, stepsPerRev: 200 };
	it("22xx uses 16/24/32/40 tCLK for TBL 0–3", () => {
		const cyc = [16, 24, 32, 40];
		for (let tbl = 0; tbl <= 3; tbl++) {
			const r = computeAutotune(m, { volts: 24, fclk: 12_500_000, tbl, blankCycles: [16, 24, 32, 40] });
			expect(r.tblank).toBeCloseTo(cyc[tbl] / 12_500_000, 12);
		}
	});
	it("5160/2240 use 16/24/36/54 tCLK for TBL 0–3", () => {
		const cyc = [16, 24, 36, 54];
		for (let tbl = 0; tbl <= 3; tbl++) {
			const r = computeAutotune(m, { volts: 24, fclk: 12_500_000, tbl, blankCycles: [16, 24, 36, 54] });
			expect(r.tblank).toBeCloseTo(cyc[tbl] / 12_500_000, 12);
		}
	});
	it("falls back to 16·1.5^TBL when no table is given (default = reference macro)", () => {
		const r = computeAutotune(m, { volts: 24, fclk: 12_500_000, tbl: 1 });
		expect(r.tblank).toBeCloseTo(24 / 12_500_000, 12);
	});
});

describe("hysteresis basis (Trinamic peak vs Klipper RMS)", () => {
	const m = { resistance: 4.5, inductance: 0.0075, holdingTorque: 0.49, maxCurrent: 2, stepsPerRev: 200 };
	const base = { volts: 24, fclk: 12_500_000 };
	it("produces valid in-range fields on the peak basis", () => {
		const r = computeAutotune(m, { ...base, hysteresisBasis: "peak", currentScaleCs: 31 });
		expect(r.chopconf.hstrt).toBeGreaterThanOrEqual(0);
		expect(r.chopconf.hstrt).toBeLessThanOrEqual(7);
		expect(r.chopconf.hend).toBeGreaterThanOrEqual(0);
		expect(r.chopconf.hend).toBeLessThanOrEqual(15);
	});
	it("a lower current scale (CS) reduces the hysteresis window", () => {
		const full = computeAutotune(m, { ...base, hysteresisBasis: "peak", currentScaleCs: 31 });
		const low = computeAutotune(m, { ...base, hysteresisBasis: "peak", currentScaleCs: 8 });
		expect(low.hstartmin).toBeLessThanOrEqual(full.hstartmin);
	});
	it("rms basis is unchanged by the CS field", () => {
		const a = computeAutotune(m, { ...base, hysteresisBasis: "rms", currentScaleCs: 31 });
		const b = computeAutotune(m, { ...base, hysteresisBasis: "rms", currentScaleCs: 8 });
		expect(a.hstartmin).toBe(b.hstartmin);
	});
});

describe("klipper-parity refinements", () => {
	it("uses the run current (not rated) for PWM_OFS when provided", () => {
		const rated = computeAutotune(REF_MOTOR, REF_OPTS);
		const run = computeAutotune(REF_MOTOR, { ...REF_OPTS, runCurrent: 0.5 });
		expect(rated.pwmofs).toBe(102); // 374·6.5·1.0/24
		expect(run.pwmofs).toBe(51); //   374·6.5·0.5/24
	});

	it("adds extra hysteresis on top of the computed window", () => {
		const base = computeAutotune(REF_MOTOR, REF_OPTS); // hstrt 1, hend −2
		const more = computeAutotune(REF_MOTOR, { ...REF_OPTS, extraHysteresis: 4 });
		expect(base.hstrt).toBe(1);
		expect(more.hstrt).toBe(3); // htotal = min(−1+4, 14) = 3
		expect(more.hend).toBe(0);
		expect(more.chopconf).toEqual({ toff: 3, tbl: 1, hstrt: 2, hend: 3 });
	});

	it("caps the hysteresis total at 14 (fields stay in range) for extreme motors", () => {
		const extreme = computeAutotune(
			{ resistance: 0.5, inductance: 0.0002, holdingTorque: 0.4, maxCurrent: 2, stepsPerRev: 200 },
			REF_OPTS,
		);
		expect(extreme.hstrt).toBeLessThanOrEqual(8);
		expect(extreme.hend).toBeLessThanOrEqual(12);
		expect(extreme.chopconf.hstrt).toBeGreaterThanOrEqual(0);
		expect(extreme.chopconf.hstrt).toBeLessThanOrEqual(7);
		expect(extreme.chopconf.hend).toBeGreaterThanOrEqual(0);
		expect(extreme.chopconf.hend).toBeLessThanOrEqual(15);
	});
});

describe("tstepFromRevsPerSec", () => {
	it("computes TSTEP = fclk / (256·stepsPerRev·revs)", () => {
		expect(tstepFromRevsPerSec(12_000_000, 200, 1)).toBe(234); // 12e6 / (256·200·1) = 234.375 → 234
	});
	it("returns the 20-bit max for zero/negative velocity and clamps", () => {
		expect(tstepFromRevsPerSec(12_000_000, 200, 0)).toBe(0xFFFFF);
		expect(tstepFromRevsPerSec(12_000_000, 200, 0.00001)).toBe(0xFFFFF); // would overflow → clamped
	});
});

describe("computeThresholds (tuning modes)", () => {
	const base = { fclk: 12_000_000, stepsPerRev: 200, holdingTorque: 0.5, maxpwmrps: 2.1, hasSg4: true, hasThigh: false };
	it("leaves thresholds untouched in chopperOnly mode", () => {
		expect(computeThresholds({ ...base, mode: "chopperOnly" })).toEqual({ tpwmthrs: null, thigh: null });
	});
	it("silent = stealthChop always (TPWMTHRS 0); performance = spreadCycle (TPWMTHRS max)", () => {
		expect(computeThresholds({ ...base, mode: "silent" }).tpwmthrs).toBe(0);
		expect(computeThresholds({ ...base, mode: "performance" }).tpwmthrs).toBe(0xFFFFF);
	});
	it("auto picks silent for high-torque motors and performance for small ones", () => {
		expect(computeThresholds({ ...base, mode: "auto", holdingTorque: 0.5 }).tpwmthrs).toBe(0);
		expect(computeThresholds({ ...base, mode: "auto", holdingTorque: 0.2 }).tpwmthrs).toBe(0xFFFFF);
	});
	it("autoSwitch computes a TSTEP threshold and sets THIGH only when the chip has it", () => {
		const noThigh = computeThresholds({ ...base, mode: "autoSwitch", hasThigh: false });
		expect(noThigh.tpwmthrs).toBeGreaterThan(0);
		expect(noThigh.tpwmthrs).toBeLessThan(0xFFFFF);
		expect(noThigh.thigh).toBeNull();
		const withThigh = computeThresholds({ ...base, mode: "autoSwitch", hasThigh: true });
		expect(withThigh.thigh).not.toBeNull();
	});
});

describe("selectPwmFreq", () => {
	it("picks the highest setting at or below the target", () => {
		expect(selectPwmFreq(12_500_000, 55_000)).toBe(2); // 48.8 kHz
		expect(selectPwmFreq(12_500_000, 61_000)).toBe(3); // 61.0 kHz
		expect(selectPwmFreq(12_500_000, 30_000)).toBe(0); // only 24.4 kHz qualifies
	});
});
