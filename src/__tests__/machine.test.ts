import { describe, expect, it } from "vitest";

import { boardFamily, chipFromIoin, discoverDrivers, listDrivers, parseChopperReport, parseRegisterValue, readRunCurrent, readVin, replyError } from "../model/machine";

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
	it("parses RRF 3.7's exact M569.2 read reply", () => {
		expect(parseRegisterValue("Register 0x6c value 0x08028083")).toBe(0x08028083);
	});
	it("never turns an error reply into a value", () => {
		expect(parseRegisterValue("Error: M569.2: Driver number 0.7 out of range")).toBeNull();
		expect(parseRegisterValue("Error: M569.2: Failed to read register")).toBeNull();
	});
});

describe("replyError", () => {
	it("finds RRF's error line", () => {
		expect(replyError("Error: M569: Bad ccr for driver 0.0")).toBe("Error: M569: Bad ccr for driver 0.0");
		expect(replyError("Warning: something\nError: M915: bad")).toBe("Error: M915: bad");
	});
	it("treats empty, normal and warning replies as success", () => {
		expect(replyError("")).toBeNull();
		expect(replyError(null)).toBeNull();
		expect(replyError("Register 0x6c value 0x00000000")).toBeNull();
		expect(replyError("Warning: driver 0.0 does not support this")).toBeNull();
	});
});

describe("parseChopperReport", () => {
	it("reads the ccr from an M569 report (RRF 3.7.0-rc.2+ format)", () => {
		const reply = "Drive 0 runs forwards, active low enable, step timing fast, mode stealthChop, ccr 0xa18053, toff 3, tblank 1, "
			+ "thigh 200 (100.0 mm/sec), gs 0, iRun/iHold 22/11, current 1200.0, tcoolthrs 2000 (12.3 mm/sec), pos 512";
		expect(parseChopperReport(reply)).toBe(0xA18053);
	});
	it("returns null without a ccr or on an error", () => {
		expect(parseChopperReport("Drive 0.3 runs forwards, active high enable, step timing fast")).toBeNull();
		expect(parseChopperReport("Error: M569: Driver number 0.9 out of range")).toBeNull();
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
	it("treats an unknown STM32-port board as tuneable (chip read/picked later)", () => {
		const f = boardFamily({ shortName: "kraken_h723" });
		expect(f.tuneable).toBe(true);
		expect(f.family).toBeNull();
	});
});

describe("chipFromIoin", () => {
	it("identifies UART parts from IOIN 0x06 VERSION", () => {
		expect(chipFromIoin({ uart: 0x21000000 })).toEqual({ chip: "TMC2209", family: "tmc22xx" });
		expect(chipFromIoin({ uart: 0x20000000 })).toEqual({ chip: "TMC2208", family: "tmc22xx" });
	});
	it("identifies SPI parts from IOIN 0x04 VERSION", () => {
		expect(chipFromIoin({ spi: 0x30000000 })).toEqual({ chip: "TMC5160", family: "tmc5160" });
		expect(chipFromIoin({ spi: 0x40000000 })).toEqual({ chip: "TMC2240", family: "tmc2240" });
	});
	it("returns null when neither read looks valid", () => {
		expect(chipFromIoin({ uart: 0, spi: 0 })).toBeNull();
		expect(chipFromIoin({})).toBeNull();
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
