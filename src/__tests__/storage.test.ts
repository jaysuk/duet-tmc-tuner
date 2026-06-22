import { describe, expect, it } from "vitest";

import { emptyStore, parseStore } from "../model/storage";

describe("parseStore", () => {
	it("returns an empty store for junk / missing fields", () => {
		expect(parseStore("not json")).toEqual(emptyStore());
		expect(parseStore("{}")).toEqual(emptyStore());
	});

	it("keeps valid custom motors and per-driver assignments", () => {
		const s = parseStore(JSON.stringify({
			version: 1,
			customMotors: [{ id: "my-motor", vendor: "Saved", resistance: 1.5, inductance: 0.0015, holdingTorque: 0.4, maxCurrent: 1.5, stepsPerRev: 200 }],
			assignments: { "0.0": { motorId: "my-motor", chip: "TMC5160" }, "121.0": { chip: "TMC2209" } },
		}));
		expect(s.customMotors).toHaveLength(1);
		expect(s.customMotors[0].id).toBe("my-motor");
		expect(s.assignments["0.0"]).toEqual({ motorId: "my-motor", chip: "TMC5160" });
		expect(s.assignments["121.0"].chip).toBe("TMC2209");
	});

	it("drops malformed custom motors (missing/invalid specs)", () => {
		const s = parseStore(JSON.stringify({ customMotors: [{ id: "bad" }, { id: "", resistance: 1, inductance: 1, holdingTorque: 1, maxCurrent: 1, stepsPerRev: 200 }] }));
		expect(s.customMotors).toHaveLength(0);
	});
});
