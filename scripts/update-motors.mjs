#!/usr/bin/env node
/**
 * Sync the built-in motor database from the upstream community motor list and regenerate
 * src/model/motorDatabase.ts. Run by scripts/update-motors workflow on a schedule; it opens a PR when
 * the generated file changes, so new motors are picked up automatically without hand-editing.
 *
 *   node scripts/update-motors.mjs            # fetch + regenerate
 *   node scripts/update-motors.mjs --check    # exit 1 if the generated file would change (no write)
 *
 * This is dev tooling only (not shipped in the plugin bundle). The generated data file contains motor
 * electrical specs from manufacturer datasheets and carries no third-party branding.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = "https://raw.githubusercontent.com/andrewmcgr/klipper_tmc_autotune/main/motor_database.cfg";
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "src", "model", "motorDatabase.ts");

// Tidy verbose source section headings into short manufacturer labels for the picker.
const VENDOR_TIDY = {
	"China Leadshine Technology Co., Ltd Motors (Leisai, Leadshine)": "Leadshine",
	"Trinamic (yes, they also make stepper motors)": "Trinamic",
	"Guangzhou Bozu Digital Technology": "Bozu",
	"OMC Stepperonline": "StepperOnline",
	"Other manufacturers": "Other",
};

// Canonical manufacturer per motor-id prefix. Upstream's "### Vendor ###" section headings are a loose
// filing system, not per-motor truth: contributors append new motors to whatever section is nearest, and
// rebadged motors are filed under the *original* maker (e.g. Bondtech-branded LDO motors sit under LDO).
// The id prefix is the brand actually printed on the motor the user bought, so it wins for the picker's
// vendor filter; anything not listed here falls back to the section heading. Keyed by the id's leading
// "-"-delimited token, lowercased. Part-number prefixes (23hs30-, bj42d22-, tb-) are deliberately absent
// so they keep their section's vendor instead of becoming a nonsense label.
const VENDOR_BY_PREFIX = {
	act: "ACT", biqu: "BIQU", bondtech: "Bondtech", bozu: "Bozu", btt: "BTT",
	cloudray: "Cloudray", creality: "Creality", damencnc: "DamenCNC", dfh: "DFH",
	flsun: "FLSun", fysetc: "FYSETC", geetech: "Geeetech", hanpose: "Hanpose",
	honeybadger: "Honey Badger", jinkong: "JKong", jkong: "JKong", kelimotor: "Keli Motor",
	kingroon: "Kingroon", ldo: "LDO", leadshine: "Leadshine", leisai: "Leadshine",
	lkd: "LKD", longs: "Longs Motor", mercury: "Mercury", monoprice: "Monoprice",
	moons: "Moons", motech: "Motech", motionking: "MotionKing", omc: "StepperOnline",
	orientalmotor: "Oriental Motor", oukeda: "Oukeda", qidi: "QIDI", rattm: "RATTM",
	rbmotor: "RB Motor", shengyang: "Shengyang", siboor: "Siboor", th3d: "TH3D",
	tmc: "Trinamic", toa: "TOA", trianglelab: "Trianglelab", tronxy: "Tronxy",
	usongshine: "Usongshine", wantai: "Wantai", zyltech: "Zyltech",
};

// Canonical spelling for every label we know, so a section-heading fallback cannot introduce a
// case-variant duplicate of a prefix-derived vendor ("Fysetc" alongside "FYSETC" splits the picker).
const CANONICAL_VENDOR = new Map(Object.values(VENDOR_BY_PREFIX).map((v) => [v.toLowerCase(), v]));

/** Manufacturer for the picker: id prefix if we recognise it, else the enclosing section heading. */
function vendorFor(id, sectionVendor) {
	const byPrefix = VENDOR_BY_PREFIX[id.split("-")[0].toLowerCase()];
	if (byPrefix) return byPrefix;
	const section = VENDOR_TIDY[sectionVendor] ?? sectionVendor ?? "Other";
	return CANONICAL_VENDOR.get(section.toLowerCase()) ?? section;
}

// Known-bad values in the upstream source, patched here (by motor id) so they don't feed garbage into
// the autotune maths and so a re-sync doesn't reintroduce them until upstream fixes it.
const CORRECTIONS = {
	// Upstream lists holding_torque: 107.7 Nm (~180x every other NEMA17 in the list). Corrected to match
	// its "(prusa-z)" sibling entry, which is the same physical motor. See andrewmcgr/klipper_tmc_autotune.
	"ldo-42sth34-1004l321e": { holdingTorque: 0.59 },
};

function parse(cfg) {
	let vendor = "";
	const entries = [];
	let cur = null;
	const flush = () => { if (cur) { entries.push(cur); cur = null; } };
	for (const raw of cfg.split(/\r?\n/)) {
		const s = raw.trim();
		if (s.startsWith("###")) {
			// Trailing hashes are optional: upstream writes "### Other manufacturers" without them, and
			// requiring them silently left the previous section's vendor in place for everything below.
			const m = s.match(/^#+\s*(.+?)\s*#*\s*$/);
			vendor = m ? m[1].replace(/\s*Motors?$/i, "").trim() : vendor;
			continue;
		}
		if (s.startsWith("##")) continue;
		const head = s.match(/^\[motor_constants\s+(.+?)\]\s*$/);
		if (head) { flush(); cur = { id: head[1].trim(), sectionVendor: vendor }; continue; }
		if (cur) {
			const kv = s.match(/^([a-z_]+)\s*:\s*([-+0-9.eE]+)/);
			if (kv) cur[kv[1]] = Number(kv[2]);
		}
	}
	flush();
	const motors = [];
	for (const e of entries) {
		const r = e.resistance, l = e.inductance, t = e.holding_torque, i = e.max_current;
		const st = e.steps_per_revolution ?? 200;
		if ([r, l, t, i].some((v) => v == null || !Number.isFinite(v))) continue;
		motors.push({ id: e.id, vendor: vendorFor(e.id, e.sectionVendor), resistance: r, inductance: l, holdingTorque: t, maxCurrent: i, stepsPerRev: Math.round(st), ...CORRECTIONS[e.id] });
	}
	// Sort by manufacturer, then naturally by id (alphabetical + 0-9) within each manufacturer.
	motors.sort((a, b) => a.vendor.localeCompare(b.vendor, undefined, { sensitivity: "base" })
		|| a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: "base" }));
	return motors;
}

function render(motors) {
	const head = [
		"/**",
		" * Built-in stepper-motor database: electrical specifications compiled from manufacturer",
		" * datasheets. Each entry feeds the autotune engine (see model/autotune.ts). Users can also",
		" * enter a custom motor by hand.",
		" *",
		" * GENERATED by scripts/update-motors.mjs — do not edit by hand.",
		" */",
		"export interface MotorSpec {",
		'\t/** Stable id / catalogue part identifier, e.g. "ldo-42sth48-2504ah". */',
		"\tid: string;",
		'\t/** Manufacturer grouping for the picker, e.g. "LDO", "Moons". */',
		"\tvendor: string;",
		"\t/** Phase (coil) resistance, ohms. */",
		"\tresistance: number;",
		"\t/** Phase (coil) inductance, henries. */",
		"\tinductance: number;",
		"\t/** Holding torque, Nm. */",
		"\tholdingTorque: number;",
		"\t/** Nominal rated (max) phase current, amps. */",
		"\tmaxCurrent: number;",
		"\t/** Full steps per revolution (200 = 1.8°, 400 = 0.9°). */",
		"\tstepsPerRev: number;",
		"}",
		"",
		`/** ${motors.length} motors, compiled from manufacturer datasheets. */`,
		"export const MOTOR_DATABASE: ReadonlyArray<MotorSpec> = [",
	];
	const rows = motors.map((m) =>
		`\t{ id: ${JSON.stringify(m.id)}, vendor: ${JSON.stringify(m.vendor)}, resistance: ${m.resistance}, ` +
		`inductance: ${m.inductance}, holdingTorque: ${m.holdingTorque}, maxCurrent: ${m.maxCurrent}, stepsPerRev: ${m.stepsPerRev} },`);
	return [...head, ...rows, "];", ""].join("\n");
}

const res = await fetch(SOURCE);
if (!res.ok) {
	console.error(`Failed to fetch motor list: HTTP ${res.status}`);
	process.exit(2);
}
const motors = parse(await res.text());
if (motors.length < 150) {
	console.error(`Refusing to write: only parsed ${motors.length} motors (source format may have changed).`);
	process.exit(2);
}

// Surface motors whose vendor came from the section heading rather than a recognised id prefix. Upstream
// adding a new brand shows up here, so VENDOR_BY_PREFIX can be extended instead of quietly shipping a
// motor filed under whichever vendor happened to precede it.
const unrecognised = motors.filter((m) => !VENDOR_BY_PREFIX[m.id.split("-")[0].toLowerCase()]);
if (unrecognised.length) {
	console.log(`${unrecognised.length} motor(s) fell back to their section heading for vendor:`);
	for (const m of unrecognised) console.log(`  ${m.id} -> ${m.vendor}`);
}
const next = render(motors);
const current = (() => { try { return readFileSync(OUT, "utf8"); } catch { return ""; } })();

if (next === current) {
	console.log(`Motor database up to date (${motors.length} motors).`);
	process.exit(0);
}

if (process.argv.includes("--check")) {
	console.error(`Motor database is out of date (${motors.length} motors upstream). Run: npm run update-motors`);
	process.exit(1);
}

writeFileSync(OUT, next, "utf8");
console.log(`Wrote ${motors.length} motors to src/model/motorDatabase.ts`);
