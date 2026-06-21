/**
 * Chopper + PWM autotune for the TMC220x/222x family.
 *
 * Given a motor's electrical constants, the supply voltage and the driver clock, this derives good
 * CHOPCONF (TOFF/TBL/HSTRT/HEND) and PWMCONF (PWM_OFS/PWM_GRAD/pwm_freq + autoscale/autograd) values
 * for quiet stealthChop operation. The formulas are the Trinamic datasheet initial-value equations
 * (TMC2209 §"Initial PWM/chopper settings"); they are deliberately the same physics used by community
 * autotune tools, ported here as plain maths so the result is transparent and unit-tested.
 *
 * Everything is pure. The returned `chopconf`/`pwmconf` objects are STORED field values ready to hand
 * to the register encoder (e.g. CHOPCONF.hstrt already holds logical-hstrt − 1).
 */

/** Motor electrical constants needed to tune (a subset of MotorSpec; custom motors supply the same). */
export interface MotorInput {
	/** Phase resistance, ohms. */
	resistance: number;
	/** Phase inductance, henries. */
	inductance: number;
	/** Holding torque, Nm. */
	holdingTorque: number;
	/** Nominal rated phase current, amps. */
	maxCurrent: number;
	/** Full steps per revolution (200 = 1.8°, 400 = 0.9°). */
	stepsPerRev: number;
}

export interface AutotuneOptions {
	/** Supply (motor) voltage, V. */
	volts: number;
	/** Driver clock, Hz. */
	fclk: number;
	/**
	 * Run (operating) current in amps, used for PWM_OFS and the hysteresis window. When omitted (or 0)
	 * the motor's rated current is used. The full algorithm prefers the actual run current (M906); the
	 * original reference macro used the rated current, which this still reproduces when none is given.
	 */
	runCurrent?: number;
	/** Chopper off-time setting (CHOPCONF.TOFF), 1–15. Default 3 (the autotune default). */
	toff?: number;
	/** Comparator blank-time setting (CHOPCONF.TBL), 0–3. Default 1. */
	tbl?: number;
	/** Extra hysteresis (0–8) added on top of the computed value to reduce humming. Default 0. */
	extraHysteresis?: number;
	/** Target stealthChop PWM frequency, Hz (the highest chip setting at or below this is chosen). */
	pwmFreqTargetHz?: number;
}

export interface AutotuneResult {
	/** Back-EMF constant, Nm/A (= V·s/rad): holdingTorque / (2·maxCurrent). */
	cbemf: number;
	/** PWM_OFS (0–255). */
	pwmofs: number;
	/** PWM_GRAD (0–255). */
	pwmgrad: number;
	/** Max revolutions/sec before stealthChop PWM saturates (informational; drives velocity thresholds). */
	maxpwmrps: number;
	/** Intermediate timing values (informational / for parity with the reference macro). */
	tblank: number;
	tsd: number;
	dcoilblank: number;
	dcoilsd: number;
	hstartmin: number;
	/** Logical HSTRT (1–8) and HEND (−3–12) before field encoding. */
	hstrt: number;
	hend: number;
	/** Selected stored field values, ready for the register encoder. */
	chopconf: { toff: number; tbl: number; hstrt: number; hend: number };
	pwmconf: { pwm_ofs: number; pwm_grad: number; pwm_freq: number; pwm_autoscale: number; pwm_autograd: number };
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}

// ── Velocity thresholds + tuning modes ──────────────────────────────────────────────────────────
//
// The TMC threshold registers (TPWMTHRS/THIGH) compare against TSTEP, the clocks between microsteps.
// Klipper derives the threshold velocities in rev/s and converts with TSTEP = fclk·step_dist_256/v,
// where step_dist_256 = rotation_distance/(stepsPerRev·256). Expressed per revolution the
// rotation_distance cancels, leaving TSTEP = fclk / (256 · stepsPerRev · v_rev) — so we need only the
// clock, the motor's steps/rev and the velocity in rev/s (no per-axis steps/mm or microstepping).

/** Tuning goal: how stealthChop and spreadCycle are scheduled by velocity. */
export type TuningMode =
	| "chopperOnly" //  only CHOPCONF + PWMCONF; don't touch the velocity thresholds (default)
	| "silent" //       stealthChop at all speeds (TPWMTHRS = 0)
	| "performance" //  spreadCycle from very low speed (TPWMTHRS = max)
	| "auto" //         silent for high-holding-torque (Z-like) motors, performance otherwise
	| "autoSwitch"; //  switch stealthChop → spreadCycle at the computed PWM-saturation speed

const TSTEP_MAX = 0xFFFFF; // 20-bit threshold registers

/** Convert a velocity in rev/s to a TSTEP threshold value (clamped to the 20-bit register). */
export function tstepFromRevsPerSec(fclk: number, stepsPerRev: number, revsPerSec: number): number {
	if (revsPerSec <= 0) return TSTEP_MAX;
	return clamp(Math.round(fclk / (256 * stepsPerRev * revsPerSec)), 0, TSTEP_MAX);
}

export interface ThresholdOptions {
	mode: TuningMode;
	fclk: number;
	stepsPerRev: number;
	holdingTorque: number;
	/** Max stealthChop rev/s (from the autotune result). */
	maxpwmrps: number;
	/** True for drivers with an SG4 threshold register (2209/2240) — changes the autoswitch point. */
	hasSg4: boolean;
	/** Whether the chip has a THIGH register (5160/2240). */
	hasThigh: boolean;
}

export interface ThresholdResult {
	/** TPWMTHRS register value, or null when the mode leaves it alone (chopperOnly). */
	tpwmthrs: number | null;
	/** THIGH register value (fullstep switch), or null when not applicable. */
	thigh: number | null;
}

const COOLSTEP_THRS_REVS = 0.75; // COOLSTEP_THRS_FACTOR
const FULLSTEP_THRS_FACTOR = 1.2;

/**
 * Compute TPWMTHRS (and THIGH) for the chosen mode. `chopperOnly` returns nulls so the thresholds are
 * left untouched (backward-compatible default). The autoswitch point mirrors the upstream algorithm.
 */
export function computeThresholds(opts: ThresholdOptions): ThresholdResult {
	const { mode, fclk, stepsPerRev, holdingTorque, maxpwmrps, hasSg4, hasThigh } = opts;
	if (mode === "chopperOnly") {
		return { tpwmthrs: null, thigh: null };
	}
	const tstep = (revs: number) => tstepFromRevsPerSec(fclk, stepsPerRev, revs);

	let tpwmthrs: number;
	if (mode === "silent") {
		tpwmthrs = 0;
	} else if (mode === "performance") {
		tpwmthrs = TSTEP_MAX;
	} else if (mode === "auto") {
		tpwmthrs = holdingTorque > 0.3 ? 0 : TSTEP_MAX; // bigger (Z-like) motors run silent
	} else {
		// autoSwitch: switch to spreadCycle around the PWM-saturation speed.
		const pwmthrsRevs = hasSg4
			? Math.max(0.2 * maxpwmrps, 1.125 * COOLSTEP_THRS_REVS)
			: 0.5 * maxpwmrps;
		tpwmthrs = tstep(pwmthrsRevs);
	}

	// THIGH: above this speed the driver falls back to full-step. Only the SPI chips have it; only set
	// it when stealthChop/spreadCycle switching is in play (i.e. not the fixed silent/performance modes).
	const thigh = hasThigh && mode === "autoSwitch" ? tstep(FULLSTEP_THRS_FACTOR * maxpwmrps) : null;
	return { tpwmthrs, thigh };
}

/**
 * Choose the highest PWM frequency setting (0–3) whose frequency is at or below the target.
 * The divisors are the TMC220x options: 2/1024, 2/683, 2/512, 2/410 of fCLK.
 */
export function selectPwmFreq(fclk: number, targetHz: number): number {
	const options: Array<[sel: number, factor: number]> = [
		[3, 2 / 410],
		[2, 2 / 512],
		[1, 2 / 683],
		[0, 2 / 1024],
	];
	for (const [sel, factor] of options) {
		if (fclk * factor <= targetHz) {
			return sel;
		}
	}
	return 0; // fall back to the lowest frequency
}

/**
 * Compute the chopper + PWM autotune values. Mirrors the reference RRF meta-gcode exactly for the
 * shared intermediate quantities (cbemf, pwmgrad, pwmofs, maxpwmrps, hstrt/hend), then packs the
 * stored CHOPCONF/PWMCONF field values.
 */
export function computeAutotune(motor: MotorInput, opts: AutotuneOptions): AutotuneResult {
	const { resistance: R, inductance: L, holdingTorque: T, maxCurrent: I, stepsPerRev: S } = motor;
	const V = opts.volts;
	const fclk = opts.fclk;
	const toff = opts.toff ?? 3;
	const tbl = opts.tbl ?? 1;
	const extra = opts.extraHysteresis ?? 0;
	const pwmFreqTargetHz = opts.pwmFreqTargetHz ?? 55_000;
	// Operating current for PWM_OFS + hysteresis: the actual run current when known, else the rated.
	const effI = opts.runCurrent && opts.runCurrent > 0 ? opts.runCurrent : I;

	const cbemf = T / (2 * I);
	const pwmgrad = Math.ceil((cbemf * 2 * Math.PI * fclk * 1.46) / (V * 256 * S));
	const pwmofs = Math.ceil((374 * R * effI) / V);
	const maxpwmrps = (255 - pwmofs) / (Math.PI * pwmgrad);

	// Blank time and short-delay time in seconds, from the TBL/TOFF settings.
	const tblank = (16 * Math.pow(1.5, tbl)) / fclk;
	const tsd = (12 + 32 * toff) / fclk;

	// Coil current slopes during blanking and slow decay, used to size the hysteresis window.
	const dcoilblank = (V * tblank) / L;
	const dcoilsd = (R * effI * 2 * tsd) / L;

	const hstartmin = Math.ceil(Math.max(0.5 + (((dcoilblank + dcoilsd) * 2 * 248 * 32) / effI) / 32 - 8, -2));
	// Add any extra hysteresis, then cap the total at 14 before splitting into HSTRT/HEND.
	const htotal = Math.min(hstartmin + extra, 14);
	const hstrt = clamp(htotal, 1, 8);
	const hend = Math.min(htotal - hstrt, 12);

	const pwm_freq = selectPwmFreq(fclk, pwmFreqTargetHz);

	return {
		cbemf, pwmofs, pwmgrad, maxpwmrps, tblank, tsd, dcoilblank, dcoilsd, hstartmin, hstrt, hend,
		chopconf: {
			toff,
			tbl,
			hstrt: hstrt - 1, // CHOPCONF.HSTRT stores hstrt − 1
			hend: hend + 3, //  CHOPCONF.HEND stores hend + 3
		},
		pwmconf: {
			pwm_ofs: clamp(pwmofs, 0, 255),
			pwm_grad: clamp(pwmgrad, 0, 255),
			pwm_freq,
			pwm_autoscale: 1,
			pwm_autograd: 1,
		},
	};
}
