/**
 * Thin reads of the DWC object model for the tuner: supply voltage, the list of configured drivers
 * (so the user can pick one), and a tolerant parser for `M569.2` read replies.
 *
 * Kept free of store imports so it's unit-testable; the component passes `machineStore.model` in.
 */
import type { FamilyId } from "./drivers";

interface OmDriverId {
	board?: number;
	driver?: number;
	toString?: () => string;
}

interface OmAxisLike {
	letter?: string;
	current?: number; // run current, mA
	drivers?: Array<OmDriverId | string | number>;
}
interface OmExtruderLike {
	current?: number; // run current, mA
	driver?: OmDriverId | string | number;
}
interface OmBoardLike {
	canAddress?: number | null;
	name?: string;
	shortName?: string;
	vIn?: { current?: number };
	drivers?: ArrayLike<unknown> | null;
}
interface OmModel {
	boards?: Array<OmBoardLike | null>;
	move?: { axes?: Array<OmAxisLike>; extruders?: Array<OmExtruderLike> };
}

/** Supply voltage (V) from the first board's VIN reading, or null when unavailable. */
export function readVin(model: unknown): number | null {
	const v = (model as OmModel)?.boards?.[0]?.vIn?.current;
	return typeof v === "number" && v > 0 ? v : null;
}

/** A driver the user can select, with its `M569.2 P` value and a friendly label. */
export interface DriverChoice {
	/** The `P` value for M569.2, e.g. "0.0" on Duet 3 or "0" on a single-board setup. */
	id: string;
	/** e.g. "X — 0.0" or "E0 — 0.1". */
	label: string;
}

function driverIdToString(d: OmDriverId | string | number | undefined): string | null {
	if (d == null) return null;
	if (typeof d === "string") return d;
	if (typeof d === "number") return String(d);
	if (typeof d.toString === "function") {
		const s = d.toString();
		if (s && s !== "[object Object]") return s;
	}
	if (typeof d.board === "number" && typeof d.driver === "number") return `${d.board}.${d.driver}`;
	if (typeof d.driver === "number") return String(d.driver);
	return null;
}

/** Enumerate drivers from the object model's axes and extruders (deduplicated, in order). */
export function listDrivers(model: unknown): Array<DriverChoice> {
	const m = model as OmModel;
	const out: Array<DriverChoice> = [];
	const seen = new Set<string>();
	const add = (id: string | null, label: string) => {
		if (id && !seen.has(id)) {
			seen.add(id);
			out.push({ id, label: `${label} — ${id}` });
		}
	};
	for (const ax of m?.move?.axes ?? []) {
		for (const d of ax.drivers ?? []) {
			add(driverIdToString(d), ax.letter ?? "?");
		}
	}
	(m?.move?.extruders ?? []).forEach((ex, i) => add(driverIdToString(ex.driver), `E${i}`));
	return out;
}

/** A driver discovered from the object model, with its inferred chip family. */
export interface DiscoveredDriver {
	/** `M569.2 P` value, "<canAddress>.<index>" (e.g. "0.0" main, "121.0" toolboard). */
	id: string;
	/** Board short name, e.g. "MB6HC" or "TOOL1LC". */
	board: string;
	/** Inferred driver family, or null when the board is unknown (user must pick). */
	family: FamilyId | null;
	/** Representative chip for display, e.g. "TMC5160" — null when unknown. */
	chip: string | null;
	/** False for boards with external drivers (6XD/1XD) or Duet 2 (TMC2660, unsupported in 3.7+). */
	tuneable: boolean;
	/** Axis/extruder this driver is assigned to (e.g. "X", "E0"), when configured. */
	assignedTo?: string;
	/** Friendly label for the picker, e.g. "X — TMC5160 (0.0)". */
	label: string;
}

interface BoardFamily {
	family: FamilyId | null;
	chip: string | null;
	tuneable: boolean;
}

/**
 * Best-effort guess of a driver's TMC family from a board's short name / name. This is only a HINT for
 * the UI's default — the STM32 port runs on many third-party boards with arbitrary names, so an unknown
 * board is treated as tuneable with no preselected chip (the user picks it, or it's read from the chip
 * via {@link chipFromIoin}). Only boards we positively know carry external/unsupported drivers are
 * flagged not-tuneable.
 */
export function boardFamily(board: { shortName?: string; name?: string }): BoardFamily {
	const s = `${board.shortName ?? ""} ${board.name ?? ""}`.toUpperCase();
	if (/6XD|1XD|EXP1XD/.test(s)) return { family: null, chip: null, tuneable: false }; // external step/dir
	if (/DUET\s*2|MAESTRO|WIFI|ETHERNET/.test(s)) return { family: null, chip: "TMC2660", tuneable: false }; // Duet 2 — not supported in 3.7+
	if (/MINI|1LC|TOOL/.test(s)) return { family: "tmc22xx", chip: "TMC2209", tuneable: true };
	if (/2240/.test(s)) return { family: "tmc2240", chip: "TMC2240", tuneable: true };
	if (/6HC|3HC/.test(s)) return { family: "tmc5160", chip: "TMC5160", tuneable: true };
	return { family: null, chip: null, tuneable: true }; // unknown board — let the user / chip read decide
}

/** IOIN register addresses that carry the chip VERSION byte: UART parts (22xx) at 0x06, SPI at 0x04. */
export const IOIN_ADDRESSES = { uart: 0x06, spi: 0x04 } as const;

/**
 * Identify a chip from its IOIN register VERSION byte (bits 31:24), read via M569.2. UART parts expose
 * IOIN at 0x06 (0x20=TMC2208, 0x21=TMC2209/2226), SPI parts at 0x04 (0x30=TMC5160/2160, 0x40=TMC2240).
 * Pass whichever reads you have; returns the matched chip + family, or null if neither looks valid.
 */
export function chipFromIoin(read: { uart?: number | null; spi?: number | null }): { chip: string; family: FamilyId } | null {
	const vUart = read.uart != null ? (read.uart >>> 24) & 0xFF : -1;
	const vSpi = read.spi != null ? (read.spi >>> 24) & 0xFF : -1;
	if (vUart === 0x20) return { chip: "TMC2208", family: "tmc22xx" };
	if (vUart === 0x21) return { chip: "TMC2209", family: "tmc22xx" };
	if (vSpi === 0x30) return { chip: "TMC5160", family: "tmc5160" };
	if (vSpi === 0x40) return { chip: "TMC2240", family: "tmc2240" };
	return null;
}

/** Map a driver id ("b.d") to the axis/extruder it's assigned to, if any. */
function assignmentFor(model: OmModel): Map<string, string> {
	const map = new Map<string, string>();
	for (const ax of model?.move?.axes ?? []) {
		for (const d of ax.drivers ?? []) {
			const id = driverIdToString(d);
			if (id && ax.letter) map.set(id, ax.letter);
		}
	}
	(model?.move?.extruders ?? []).forEach((ex, i) => {
		const id = driverIdToString(ex.driver);
		if (id) map.set(id, `E${i}`);
	});
	return map;
}

/**
 * Enumerate every physical driver across all boards (main, expansion and toolboards) from the object
 * model, inferring each one's TMC family from its board. This is how the plugin determines which
 * drivers are fitted and tuneable on the STM32 port, where the chip type isn't in the model.
 */
export function discoverDrivers(model: unknown): Array<DiscoveredDriver> {
	const m = model as OmModel;
	const assigned = assignmentFor(m);
	const out: Array<DiscoveredDriver> = [];
	for (const board of m?.boards ?? []) {
		if (!board) continue;
		const count = board.drivers?.length ?? 0;
		if (!count) continue;
		const fam = boardFamily(board);
		const canAddr = board.canAddress ?? 0;
		const boardName = board.shortName || board.name || `board ${canAddr}`;
		for (let j = 0; j < count; j++) {
			const id = `${canAddr}.${j}`;
			const axis = assigned.get(id);
			const chipText = fam.chip ?? "unknown";
			out.push({
				id, board: boardName, family: fam.family, chip: fam.chip, tuneable: fam.tuneable,
				assignedTo: axis,
				label: `${axis ? axis + " — " : ""}${chipText} (${id})${fam.tuneable ? "" : " — not tuneable"}`,
			});
		}
	}
	return out;
}

/**
 * RepRapFirmware specifies motor current as PEAK (M906), whereas the TMC autotune formulas — like the
 * Klipper plugin they come from — expect RMS current. So any current read from RRF must be scaled by
 * 1/√2 before it goes into the maths. (Motor datasheet *rated* current in the database is a separate,
 * fixed motor property and is used as-is, matching the upstream algorithm.)
 */
export const PEAK_TO_RMS = 1 / Math.SQRT2;

/** Convert an RRF peak current (A) to the RMS current the autotune formulas expect. */
export function peakToRms(peakAmps: number): number {
	return peakAmps * PEAK_TO_RMS;
}

/** Run (operating) PEAK current in amps for a driver id (RRF convention), from the axis/extruder it drives. Null if unknown. */
export function readRunCurrent(model: unknown, driverId: string): number | null {
	const m = model as OmModel;
	for (const ax of m?.move?.axes ?? []) {
		if ((ax.drivers ?? []).some((d) => driverIdToString(d) === driverId) && typeof ax.current === "number") {
			return ax.current / 1000;
		}
	}
	for (const ex of m?.move?.extruders ?? []) {
		if (driverIdToString(ex.driver) === driverId && typeof ex.current === "number") {
			return ex.current / 1000;
		}
	}
	return null;
}

/**
 * Parse the 32-bit value from an `M569.2` read reply. RRF phrasings vary, so this is deliberately
 * tolerant: prefer a hex value after "value"/"=", else the last 0x token, else the last integer.
 * Returns an unsigned 32-bit number, or null when nothing parses.
 */
export function parseRegisterValue(reply: string | null | undefined): number | null {
	const text = reply ?? "";
	// Prefer the token right after "value"/"=" (the value, not the register address before it).
	const tagged = text.match(/(?:value|=)\s*(0x[0-9a-fA-F]{1,8}|\d+)/i);
	if (tagged) {
		const tok = tagged[1];
		return (tok.startsWith("0x") || tok.startsWith("0X") ? parseInt(tok, 16) : parseInt(tok, 10)) >>> 0;
	}
	// Fallbacks: last hex token, else last decimal token.
	const hexes = text.match(/0x[0-9a-fA-F]{1,8}/g);
	if (hexes && hexes.length) return parseInt(hexes[hexes.length - 1], 16) >>> 0;
	const ints = text.match(/\d+/g);
	if (ints && ints.length) return Number(ints[ints.length - 1]) >>> 0;
	return null;
}
