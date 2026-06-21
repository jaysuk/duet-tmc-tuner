import { describe, expect, it } from "vitest";

import { listDrivers, parseRegisterValue, readVin } from "../model/machine";

describe("parseRegisterValue", () => {
	it("parses a hex value after 'value'", () => {
		expect(parseRegisterValue("Driver 0.0 register 0x6C value 0x08028083")).toBe(0x08028083);
	});
	it("parses a hex value after '='", () => {
		expect(parseRegisterValue("register 108 = 0x8083")).toBe(0x8083);
	});
	it("parses a decimal value after 'value'", () => {
		expect(parseRegisterValue("driver 0 register 112 value 923494")).toBe(923494);
	});
	it("handles a zero value even with a hex address present", () => {
		expect(parseRegisterValue("register 0x70 = 0")).toBe(0);
	});
	it("falls back to the last hex token", () => {
		expect(parseRegisterValue("0x6C 0x000080A1")).toBe(0x80A1);
	});
	it("returns null when nothing parses", () => {
		expect(parseRegisterValue("no value here")).toBeNull();
		expect(parseRegisterValue(null)).toBeNull();
	});
});

describe("readVin", () => {
	it("reads the first board's VIN", () => {
		expect(readVin({ boards: [{ vIn: { current: 24.3 } }] })).toBeCloseTo(24.3, 3);
	});
	it("returns null when missing", () => {
		expect(readVin({ boards: [] })).toBeNull();
		expect(readVin({})).toBeNull();
	});
});

describe("listDrivers", () => {
	it("enumerates axis + extruder drivers with labels", () => {
		const model = {
			move: {
				axes: [
					{ letter: "X", drivers: ["0.0"] },
					{ letter: "Y", drivers: ["0.1"] },
				],
				extruders: [{ driver: "0.2" }],
			},
		};
		const out = listDrivers(model);
		expect(out.map((d) => d.id)).toEqual(["0.0", "0.1", "0.2"]);
		expect(out[0].label).toBe("X — 0.0");
		expect(out[2].label).toBe("E0 — 0.2");
	});

	it("dedupes and tolerates {board,driver} objects", () => {
		const model = {
			move: { axes: [{ letter: "X", drivers: [{ board: 0, driver: 0 }] }, { letter: "U", drivers: [{ board: 0, driver: 0 }] }] },
		};
		expect(listDrivers(model).map((d) => d.id)).toEqual(["0.0"]);
	});
});
