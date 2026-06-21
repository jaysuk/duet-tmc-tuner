/**
 * Generic TMC register bit-field encode / decode / read-modify-write, plus M569.2 emission.
 *
 * The plugin writes driver registers DIRECTLY (RepRapFirmware `M569.2 P<driver> R<reg> V<value>`),
 * not via high-level tuning codes. RRF programs the same registers itself from M569/M906/microstepping,
 * so the safe way to change only the autotuned fields is read-modify-write: read the live register with
 * `M569.2 P<d> R<reg>`, overlay the computed fields, and write the whole 32-bit word back. These
 * helpers are pure (BigInt internally so bit 31 is handled correctly) and exhaustively unit-tested.
 */

/** One packed field within a 32-bit register: `width` bits starting at `bit` (LSB = 0). */
export interface RegisterField {
	/** Least-significant bit position of the field. */
	bit: number;
	/** Field width in bits. */
	width: number;
	/**
	 * Some TMC fields store a value offset from what the datasheet/UI calls it (e.g. CHOPCONF.HSTRT
	 * holds `hstrt − 1`, HEND holds `hend + 3`). `offset` is added to the logical value to get the
	 * stored field value; it is for documentation/decoding aids only — callers pass the STORED value.
	 */
	offset?: number;
}

/** A named driver register at a fixed address with its field layout. */
export interface RegisterDef {
	/** Human name, e.g. "CHOPCONF". */
	name: string;
	/** Register address (the decimal `R` value for M569.2; TMC datasheets give it in hex). */
	address: number;
	fields: Record<string, RegisterField>;
}

const U32 = 0xFFFFFFFFn;

function mask(field: RegisterField): bigint {
	return ((1n << BigInt(field.width)) - 1n) << BigInt(field.bit);
}

/** Pack a complete set of stored field values into a 32-bit word (unmentioned fields read as 0). */
export function encodeFields(def: RegisterDef, fields: Record<string, number>): number {
	let word = 0n;
	for (const [name, value] of Object.entries(fields)) {
		const f = def.fields[name];
		if (!f) {
			throw new Error(`Unknown field "${name}" for register ${def.name}`);
		}
		const fieldMask = (1n << BigInt(f.width)) - 1n;
		word |= (BigInt(Math.trunc(value)) & fieldMask) << BigInt(f.bit);
	}
	return Number(word & U32);
}

/** Read-modify-write: start from `currentWord` and overlay only the given fields. */
export function applyFields(def: RegisterDef, currentWord: number, fields: Record<string, number>): number {
	let word = BigInt(currentWord >>> 0);
	for (const [name, value] of Object.entries(fields)) {
		const f = def.fields[name];
		if (!f) {
			throw new Error(`Unknown field "${name}" for register ${def.name}`);
		}
		const fieldMask = (1n << BigInt(f.width)) - 1n;
		word = (word & ~mask(f)) | ((BigInt(Math.trunc(value)) & fieldMask) << BigInt(f.bit));
	}
	return Number(word & U32);
}

/** Extract every field's stored value from a 32-bit word. */
export function decodeFields(def: RegisterDef, word: number): Record<string, number> {
	const w = BigInt(word >>> 0);
	const out: Record<string, number> = {};
	for (const [name, f] of Object.entries(def.fields)) {
		const fieldMask = (1n << BigInt(f.width)) - 1n;
		out[name] = Number((w >> BigInt(f.bit)) & fieldMask);
	}
	return out;
}

/** Format an `M569.2` write for a driver + register word (decimal address and value, as RRF expects). */
export function toM569_2Write(driver: string | number, def: RegisterDef, word: number): string {
	return `M569.2 P${driver} R${def.address} V${word >>> 0}`;
}

/** Format an `M569.2` read (no V) for a driver + register. */
export function toM569_2Read(driver: string | number, def: RegisterDef): string {
	return `M569.2 P${driver} R${def.address}`;
}
