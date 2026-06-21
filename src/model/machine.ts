/**
 * Thin reads of the DWC object model for the tuner: supply voltage, the list of configured drivers
 * (so the user can pick one), and a tolerant parser for `M569.2` read replies.
 *
 * Kept free of store imports so it's unit-testable; the component passes `machineStore.model` in.
 */

interface OmDriverId {
	board?: number;
	driver?: number;
	toString?: () => string;
}

interface OmAxisLike {
	letter?: string;
	drivers?: Array<OmDriverId | string | number>;
}
interface OmExtruderLike {
	driver?: OmDriverId | string | number;
}
interface OmModel {
	boards?: Array<{ vIn?: { current?: number } } | null>;
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
