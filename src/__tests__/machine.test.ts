import { describe, expect, it } from "vitest";

import { boardFamily, discoverDrivers, listDrivers, parseRegisterValue, readRunCurrent, readVin } from "../model/machine";

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

describe("boardFamily", () => {
	it("infers the family from the board short name", () => {
		expect(boardFamily({ shortName: "MB6HC" }).family).toBe("tmc5160");
		expect(boardFamily({ shortName: "EXP3HC" }).family).toBe("tmc5160");
		expect(boardFamily({ shortName: "Mini5plus" }).family).toBe("tmc22xx");
		expect(boardFamily({ shortName: "TOOL1LC" }).family).toBe("tmc22xx");
	});
	it("flags external-driver and Duet 2 boards as not tuneable", () => {
		expect(boardFamily({ shortName: "MB6XD" }).tuneable).toBe(false);
		expect(boardFamily({ name: "Duet 2 WiFi" }).tuneable).toBe(false);
	});
});

describe("discoverDrivers", () => {
	// Mainboard (5160) + toolboard on CAN address 121 (2209), with X and E0 assigned.
	const model = {
		boards: [
			{ canAddress: 0, shortName: "MB6HC", drivers: { length: 6 } },
			{ canAddress: 121, shortName: "TOOL1LC", drivers: { length: 1 } },
		],
		move: {
			axes: [{ letter: "X", current: 1600, drivers: ["0.0"] }],
			extruders: [{ current: 800, driver: "121.0" }],
		},
	};

	it("enumerates drivers across the main + tool boards with inferred families", () => {
		const d = discoverDrivers(model);
		expect(d.length).toBe(7); // 6 on the mainboard + 1 on the toolboard
		const main0 = d.find((x) => x.id === "0.0")!;
		expect(main0.family).toBe("tmc5160");
		expect(main0.chip).toBe("TMC5160");
		expect(main0.assignedTo).toBe("X");
		const tool = d.find((x) => x.id === "121.0")!;
		expect(tool.family).toBe("tmc22xx");
		expect(tool.chip).toBe("TMC2209");
		expect(tool.assignedTo).toBe("E0");
	});

	it("reads run current (A) for a driver from its axis/extruder", () => {
		expect(readRunCurrent(model, "0.0")).toBeCloseTo(1.6, 6);
		expect(readRunCurrent(model, "121.0")).toBeCloseTo(0.8, 6);
		expect(readRunCurrent(model, "0.5")).toBeNull();
	});
});
