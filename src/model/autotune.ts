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
	/** Chopper off-time setting (CHOPCONF.TOFF), 1–15. Default 3 (the autotune default). */
	toff?: number;
	/** Comparator blank-time setting (CHOPCONF.TBL), 0–3. Default 1. */
	tbl?: number;
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
	const pwmFreqTargetHz = opts.pwmFreqTargetHz ?? 55_000;

	const cbemf = T / (2 * I);
	const pwmgrad = Math.ceil((cbemf * 2 * Math.PI * fclk * 1.46) / (V * 256 * S));
	const pwmofs = Math.ceil((374 * R * I) / V);
	const maxpwmrps = (255 - pwmofs) / (Math.PI * pwmgrad);

	// Blank time and short-delay time in seconds, from the TBL/TOFF settings.
	const tblank = (16 * Math.pow(1.5, tbl)) / fclk;
	const tsd = (12 + 32 * toff) / fclk;

	// Coil current slopes during blanking and slow decay, used to size the hysteresis window.
	const dcoilblank = (V * tblank) / L;
	const dcoilsd = (R * I * 2 * tsd) / L;

	const hstartmin = Math.ceil(Math.max(0.5 + (((dcoilblank + dcoilsd) * 2 * 248 * 32) / I) / 32 - 8, -2));
	const hstrt = clamp(hstartmin, 1, 8);
	const hend = Math.min(hstartmin - hstrt, 12);

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
