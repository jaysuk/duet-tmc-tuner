/**
 * Persistent store kept ON THE PRINTER (SD card), so it survives plugin updates, DWC settings resets
 * and switching browsers/profiles — unlike localStorage. Holds user-saved custom motors and the
 * per-driver motor/chip assignments. One small JSON file in /sys, read on load and rewritten on change.
 *
 * Uses the externalised machine store's silent upload/download (same mechanism as FL's SD backup).
 */
import { useMachineStore } from "@/stores/machine";

import type { MotorSpec } from "./motorDatabase";

/** Path of the store file on the printer. */
export const STORE_PATH = "0:/sys/duet-tmc-tuner.json";

/** A motor the user saved on the printer (a MotorSpec with vendor forced to the "saved" group). */
export type SavedMotor = MotorSpec;

/** Per-driver remembered selection. */
export interface DriverAssignment {
	motorId?: string;
	chip?: string;
}

export interface TunerStore {
	version: number;
	/** User-saved custom motors. */
	customMotors: Array<SavedMotor>;
	/** driverId ("board.driver") → remembered motor + chip. */
	assignments: Record<string, DriverAssignment>;
}

export function emptyStore(): TunerStore {
	return { version: 1, customMotors: [], assignments: {} };
}

async function toText(v: unknown): Promise<string> {
	if (typeof v === "string") return v;
	if (v instanceof Blob) return v.text();
	return String(v);
}

/** Validate + coerce parsed JSON into a TunerStore (defensive against hand-edits / old formats). */
export function parseStore(text: string): TunerStore {
	const out = emptyStore();
	try {
		const o = JSON.parse(text) as Partial<TunerStore>;
		if (Array.isArray(o.customMotors)) {
			out.customMotors = o.customMotors.filter((m): m is SavedMotor =>
				!!m && typeof m.id === "string" && m.id.trim().length > 0
				&& [m.resistance, m.inductance, m.holdingTorque, m.maxCurrent, m.stepsPerRev].every((n) => typeof n === "number" && n > 0));
		}
		if (o.assignments && typeof o.assignments === "object") {
			for (const [k, v] of Object.entries(o.assignments)) {
				if (v && typeof v === "object") {
					out.assignments[k] = { motorId: (v as DriverAssignment).motorId, chip: (v as DriverAssignment).chip };
				}
			}
		}
	} catch { /* corrupt → empty store */ }
	return out;
}

/** Load the store from the printer (empty store if missing/invalid/offline). */
export async function loadStore(): Promise<TunerStore> {
	const machineStore = useMachineStore();
	if (!machineStore.isConnected) return emptyStore();
	try {
		const res = await machineStore.download(STORE_PATH, false, false, false);
		return parseStore(await toText(res));
	} catch {
		return emptyStore(); // not created yet
	}
}

/** Write the store to the printer. Returns true on success. */
export async function saveStore(store: TunerStore): Promise<boolean> {
	const machineStore = useMachineStore();
	if (!machineStore.isConnected) return false;
	try {
		await (machineStore as unknown as {
			upload: (f: { filename: string; content: Blob }, a: boolean, b: boolean, c: boolean) => Promise<unknown>;
		}).upload({ filename: STORE_PATH, content: new Blob([JSON.stringify(store)], { type: "application/json" }) }, false, false, false);
		return true;
	} catch {
		return false;
	}
}
