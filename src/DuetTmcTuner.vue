<template>
	<v-row>
		<v-col>
			<v-card>
				<v-tabs v-model="tab" color="primary">
					<v-tab value="tune"><v-icon start>mdi-tune-vertical</v-icon>Tune</v-tab>
					<v-tab value="about"><v-icon start>mdi-information-outline</v-icon>About</v-tab>
				</v-tabs>

				<v-tabs-window v-model="tab">
					<!-- ── TUNE ───────────────────────────────────────────── -->
					<v-tabs-window-item value="tune">
						<v-card-text>
							<v-alert type="info" density="compact" variant="tonal" class="mb-4">
								Computes quiet stealthChop chopper + PWM register values from a motor's electrical specs and
								writes them <strong>directly to the driver registers</strong> with <code>M569.2</code>. Read the
								live registers first so only the tuned fields change (your microstep/current bits are kept).
							</v-alert>
							<div class="d-flex justify-end mb-2">
								<v-btn size="small" variant="text" prepend-icon="mdi-backup-restore" @click="resetToDefault"
									title="Reset settings to defaults (saved motors and per-driver assignments are kept)">Reset to defaults</v-btn>
							</div>

							<v-row>
								<!-- Motor -->
								<v-col cols="12" md="6">
									<div class="text-subtitle-2 mb-2">Motor</div>
									<v-select v-model="vendor" :items="vendorItems" label="Manufacturer" density="compact"
											  variant="outlined" hide-details class="mb-2">
										<template #append-inner><HelpTip text="Manufacturer used to filter the motor list. Pick 'Custom' to enter datasheet values yourself." /></template>
									</v-select>
									<v-select v-if="vendor !== CUSTOM" v-model="motorId" :items="motorItems" label="Motor"
											  density="compact" variant="outlined" hide-details
											  :hint="motorHint" persistent-hint class="mb-2">
										<template #append-inner><HelpTip text="Your motor. Its resistance, inductance, holding torque, rated current and steps/rev drive the calculation." /></template>
									</v-select>
									<template v-else>
										<v-row dense>
											<v-col cols="6"><v-text-field v-model.number="custom.resistance" type="number" label="Resistance (Ω)" density="compact" variant="outlined" hide-details>
												<template #append-inner><HelpTip text="Motor phase (coil) resistance in ohms, from its datasheet." /></template>
											</v-text-field></v-col>
											<v-col cols="6"><v-text-field v-model.number="custom.stepsPerRev" type="number" label="Steps / rev" density="compact" variant="outlined" hide-details>
												<template #append-inner><HelpTip text="Full steps per revolution: 200 for a 1.8° motor, 400 for a 0.9° motor." /></template>
											</v-text-field></v-col>
											<v-col cols="8"><v-text-field v-model.number="custom.inductance" type="number" label="Inductance" density="compact" variant="outlined" hide-details>
												<template #append-inner><HelpTip text="Motor phase inductance from the datasheet. Pick the unit on the right (datasheets usually quote mH)." /></template>
											</v-text-field></v-col>
											<v-col cols="4"><v-select v-model="customUnits.inductance" :items="inductanceUnits" label="Unit" density="compact" variant="outlined" hide-details /></v-col>
											<v-col cols="8"><v-text-field v-model.number="custom.holdingTorque" type="number" label="Holding torque" density="compact" variant="outlined" hide-details>
												<template #append-inner><HelpTip text="Motor holding torque from the datasheet. Pick the unit on the right (commonly N·cm or kgf·cm)." /></template>
											</v-text-field></v-col>
											<v-col cols="4"><v-select v-model="customUnits.holdingTorque" :items="torqueUnits" label="Unit" density="compact" variant="outlined" hide-details /></v-col>
											<v-col cols="8"><v-text-field v-model.number="custom.maxCurrent" type="number" label="Rated current" density="compact" variant="outlined" hide-details>
												<template #append-inner><HelpTip text="Motor rated (maximum) phase current from the datasheet — NOT your configured run current." /></template>
											</v-text-field></v-col>
											<v-col cols="4"><v-select v-model="customUnits.current" :items="currentUnits" label="Unit" density="compact" variant="outlined" hide-details /></v-col>
										</v-row>
										<div class="text-caption text-medium-emphasis mt-1">≈ {{ customBaseSummary }}</div>
										<div class="d-flex ga-2 mt-1">
											<v-btn size="x-small" variant="tonal" prepend-icon="mdi-content-save" :disabled="!motorInput" @click="openSaveMotor">Save motor to printer</v-btn>
											<v-btn size="x-small" variant="text" prepend-icon="mdi-share-variant" :disabled="!motorInput" @click="copyMotorForSharing">Copy to share</v-btn>
										</div>
									</template>
								</v-col>

								<!-- Driver -->
								<v-col cols="12" md="6">
									<div class="text-subtitle-2 mb-2">Driver</div>
									<v-row dense>
										<v-col cols="6"><v-combobox v-model="driver" :items="driverItems" :return-object="false" label="Driver (M569.2 P)" :hint="detectedHint" persistent-hint density="compact" variant="outlined"><template #append-inner><HelpTip text="The driver to tune, as M569.2's P value (board.driver, e.g. 0.0 or 121.0). Auto-detected; the list shows each driver's mapped axis." :href="DOC.gcodes" /></template></v-combobox></v-col>
										<v-col cols="6"><v-select v-model="chip" :items="chipItems" label="Driver chip" density="compact" variant="outlined" hide-details><template #append-inner><HelpTip text="TMC chip family. Use 'Detect chip' to read it from the driver's IOIN version over M569.2." :href="DOC.gcodes" /></template></v-select></v-col>
										<v-col cols="4"><v-text-field v-model.number="volts" type="number" label="Voltage (V)" density="compact" variant="outlined" hide-details class="mt-2"><template #append-inner><HelpTip text="Motor power-supply voltage (VIN). Auto-read from the board when connected." /></template></v-text-field></v-col>
										<v-col cols="4"><v-text-field v-model.number="runCurrent" type="number" label="Run current (A peak)" density="compact" variant="outlined" hide-details clearable placeholder="rated" class="mt-2"><template #append-inner><HelpTip text="Your configured run current (M906, PEAK). Converted ÷√2 to RMS for the formulas. Clear to use the motor's rated current." :href="DOC.gcodes" /></template></v-text-field></v-col>
										<v-col cols="4"><v-text-field v-model.number="fclk" type="number" label="Clock (Hz)" density="compact" variant="outlined" hide-details class="mt-2"><template #append-inner><HelpTip text="TMC driver internal clock used by the formulas (chip default; rarely changed)." /></template></v-text-field></v-col>
									</v-row>
									<div class="text-caption text-medium-emphasis mt-1">
										Drivers on the mainboard, expansion and toolboards are auto-detected from the object model.
									</div>
									<div class="text-caption text-medium-emphasis">{{ currentNote }}</div>
									<v-select v-model="mode" :items="modeItems" label="Tuning mode" density="compact" variant="outlined"
											  hide-details class="mt-2"
											  hint="Adds the stealthChop↔spreadCycle velocity thresholds (TPWMTHRS/THIGH). Needs M569 stealthChop (D3) enabled to take effect." persistent-hint>
										<template #append-inner><HelpTip text="Tuning mode — sets the stealthChop↔spreadCycle velocity thresholds (TPWMTHRS/THIGH). Needs M569 D3 (stealthChop) to take effect." :href="DOC.tuning" /></template>
									</v-select>
									<v-expansion-panels class="mt-2" variant="accordion">
										<v-expansion-panel title="Advanced (chopper)">
											<v-expansion-panel-text>
												<v-row dense>
													<v-col cols="3"><v-text-field v-model.number="toff" type="number" label="TOFF (1–15)" density="compact" variant="outlined" hide-details><template #append-inner><HelpTip text="Chopper off-time (CHOPCONF TOFF), 1–15. The autotune default is 3." :href="DOC.tuning" /></template></v-text-field></v-col>
													<v-col cols="3"><v-text-field v-model.number="tbl" type="number" label="TBL (0–3)" density="compact" variant="outlined" hide-details><template #append-inner><HelpTip text="Comparator blank time (CHOPCONF TBL), 0–3. The autotune default is 1." :href="DOC.tuning" /></template></v-text-field></v-col>
													<v-col cols="3"><v-text-field v-model.number="extraHysteresis" type="number" label="Extra hyst." density="compact" variant="outlined" hide-details><template #append-inner><HelpTip text="Extra chopper hysteresis (0–8) added on top of the computed value to reduce audible motor hum." :href="DOC.tuning" /></template></v-text-field></v-col>
													<v-col cols="3"><v-text-field v-model.number="pwmFreqTargetHz" type="number" label="PWM Hz" density="compact" variant="outlined" hide-details><template #append-inner><HelpTip text="Target stealthChop PWM frequency. The highest chip setting at or below this is used (55 kHz for 22xx, 20 kHz for 5160/2240)." :href="DOC.tuning" /></template></v-text-field></v-col>
												</v-row>
												<v-row dense class="mt-2">
													<v-col cols="7"><v-select v-model="hysteresisBasis" :items="hysteresisBasisItems" label="Hysteresis basis" density="compact" variant="outlined" hide-details><template #append-inner><HelpTip text="RMS = Klipper/validated default. Peak = Trinamic calculation-sheet exact (uses the peak coil current and the CS+1 current-scale factor)." :href="DOC.tuning" /></template></v-select></v-col>
													<v-col v-if="hysteresisBasis === 'peak'" cols="5"><v-text-field v-model.number="currentScaleCs" type="number" :min="0" :max="31" label="Current scale CS (0–31)" density="compact" variant="outlined" hide-details><template #append-inner><HelpTip text="TMC current-scale (CS) the driver runs at; 31 = full scale. Only used by the Trinamic (peak) hysteresis basis." :href="DOC.tuning" /></template></v-text-field></v-col>
												</v-row>
											</v-expansion-panel-text>
										</v-expansion-panel>
										<v-expansion-panel title="CoolStep & StallGuard">
											<v-expansion-panel-text>
												<v-alert v-if="!advancedSupported" type="info" density="compact" variant="tonal">
													{{ chip }} has no CoolStep / StallGuard.
												</v-alert>
												<template v-else>
													<v-switch v-model="coolStep" color="primary" density="compact" hide-details label="CoolStep (dynamic current)" />
													<v-switch v-model="stallGuard" color="primary" density="compact" hide-details label="StallGuard (sensorless)" />
													<v-text-field v-if="stallGuard" v-model.number="sgValue" type="number" :min="sgRange.min" :max="sgRange.max"
														              density="compact" variant="outlined" hide-details class="mt-2" :label="sgRange.label">
															<template #append-inner><HelpTip text="StallGuard threshold. Higher = less sensitive. Affects sensorless homing and usually needs tuning per machine." :href="DOC.stall" /></template>
														</v-text-field>
													<v-alert v-if="coolStep || stallGuard" type="warning" density="compact" variant="tonal" class="mt-2">
														These change dynamic current / sensorless-homing sensitivity. Test carefully — the StallGuard threshold usually needs per-machine tuning.
													</v-alert>
												</template>
											</v-expansion-panel-text>
										</v-expansion-panel>
									</v-expansion-panels>
								</v-col>
							</v-row>

							<v-alert v-if="!result" type="warning" density="compact" class="mt-4">
								Enter valid, positive motor specs and supply voltage to compute register values.
							</v-alert>

							<template v-else>
								<v-divider class="my-4" />
								<div class="d-flex align-center flex-wrap ga-2 mb-2">
									<div class="text-subtitle-2">Computed registers</div>
									<v-spacer />
									<v-btn size="small" variant="tonal" prepend-icon="mdi-chip" :disabled="!isConnected || busy"
										   :loading="detecting" @click="detectChip">Detect chip</v-btn>
									<v-btn size="small" variant="tonal" prepend-icon="mdi-download-network" :disabled="!isConnected || busy"
										   :loading="reading" @click="readBack">Read current registers</v-btn>
									<v-btn size="small" color="primary" prepend-icon="mdi-upload-network" :disabled="!isConnected || busy || !hasRead"
										   :loading="applyingRegs" @click="applyNow">Apply now</v-btn>
								</div>

								<v-alert v-if="!hasRead" type="info" density="compact" variant="tonal" class="mb-3">
									Registers not read yet — <strong>Apply now</strong> is disabled until the live values are read
									(it's automatic when you pick a driver while connected, or use <strong>Read current registers</strong>),
									so the read-modify-write keeps your microstep/current bits.
								</v-alert>

								<v-table density="compact" class="reg-table mb-3">
									<thead>
										<tr><th>Register</th><th>Key fields</th><th>Word</th><th>M569.2</th></tr>
									</thead>
									<tbody>
										<tr v-for="w in writes" :key="w.register">
											<td class="font-weight-medium">{{ w.register }}</td>
											<td>{{ fieldSummary(w.register) }}</td>
											<td><code>0x{{ hex(w.word) }}</code></td>
											<td><code>{{ w.command }}</code></td>
										</tr>
									</tbody>
								</v-table>

								<v-expansion-panels variant="accordion" class="mb-3">
									<v-expansion-panel title="Show intermediate values">
										<v-expansion-panel-text>
											<v-table density="compact" class="reg-table">
												<tbody>
													<tr><td>cbemf (Nm/A)</td><td>{{ result.cbemf.toFixed(4) }}</td></tr>
													<tr><td>PWM_OFS</td><td>{{ result.pwmofs }}</td></tr>
													<tr><td>PWM_GRAD</td><td>{{ result.pwmgrad }}</td></tr>
													<tr><td>max stealthChop rev/s</td><td>{{ result.maxpwmrps.toFixed(3) }}</td></tr>
													<tr><td>HSTRT / HEND (logical)</td><td>{{ result.hstrt }} / {{ result.hend }}</td></tr>
													<tr><td>pwm_freq select</td><td>{{ result.pwmconf.pwm_freq }}</td></tr>
												</tbody>
											</v-table>
										</v-expansion-panel-text>
									</v-expansion-panel>
								</v-expansion-panels>

								<div class="d-flex align-center mb-1">
									<div class="text-subtitle-2">For config.g</div>
									<v-spacer />
									<v-btn size="small" variant="text" prepend-icon="mdi-content-copy" @click="copyBlock">Copy</v-btn>
								</div>
								<pre class="config-block">{{ configBlock }}</pre>
								<v-snackbar v-model="copied" :timeout="2000" color="success" location="top">Copied</v-snackbar>
								<v-dialog v-model="saveMotorDialog" max-width="420">
									<v-card>
										<v-card-title>Save motor to printer</v-card-title>
										<v-card-text>
											<v-text-field v-model="saveMotorName" label="Motor name" density="compact" variant="outlined" autofocus
														  hint="Stored on the SD card — survives plugin updates. Reuse a name to overwrite." persistent-hint @keyup.enter="confirmSaveMotor" />
											<div class="text-caption text-medium-emphasis mt-2">≈ {{ customBaseSummary }}</div>
										</v-card-text>
										<v-card-actions>
											<v-spacer />
											<v-btn variant="text" @click="saveMotorDialog = false">Cancel</v-btn>
											<v-btn color="primary" :disabled="!saveMotorName.trim()" @click="confirmSaveMotor">Save</v-btn>
										</v-card-actions>
									</v-card>
								</v-dialog>
							</template>
						</v-card-text>
					</v-tabs-window-item>

					<!-- ── ABOUT ──────────────────────────────────────────── -->
					<v-tabs-window-item value="about">
						<v-card-text>
							<p class="text-body-2 text-medium-emphasis mb-4">
								Duet TMC Tuner derives stealthChop chopper/PWM register values from a motor's datasheet
								constants (resistance, inductance, holding torque, rated current, steps/rev) and the supply
								voltage, using the Trinamic datasheet initial-value equations, then writes them straight to the
								driver registers with <code>M569.2</code>. Built-in database of {{ motorCount }} motors.
							</p>

							<div class="d-flex align-center mb-1">
								<div class="text-subtitle-2">Updates</div>
								<v-spacer />
								<v-btn size="small" variant="text" :loading="checking" prepend-icon="mdi-refresh" @click="checkNow">Check now</v-btn>
							</div>
							<v-alert v-if="pendingReload" type="success" density="comfortable" class="mb-2">
								<div class="d-flex align-center flex-wrap ga-2">
									<div class="flex-grow-1">Update installed — reload DWC to finish.</div>
									<v-btn color="success" prepend-icon="mdi-restart" @click="reloadPage">Reload</v-btn>
								</div>
							</v-alert>
							<v-alert v-else-if="update && update.scenario === 'pluginUpdate'" type="info" density="comfortable" class="mb-2">
								<div class="d-flex align-center flex-wrap ga-2">
									<div class="flex-grow-1">
										<div class="font-weight-medium">Update available: v{{ update.latestVersion }}</div>
										<div class="text-caption">Installed: v{{ update.currentVersion }}</div>
									</div>
									<v-btn color="primary" :loading="applying" :disabled="!isConnected" prepend-icon="mdi-download" @click="updateNow">Update now</v-btn>
									<v-btn v-if="update.releaseUrl" variant="text" :href="update.releaseUrl" target="_blank" rel="noopener">Release notes</v-btn>
									<v-btn variant="text" size="small" @click="dismissUpdate">Dismiss</v-btn>
								</div>
							</v-alert>
							<v-alert v-else-if="update && update.scenario === 'dwcUpdate'" type="warning" density="comfortable" class="mb-2">
								<div class="font-weight-medium">Update available: v{{ update.latestVersion }}</div>
								<div class="text-caption">Needs DuetWebControl {{ update.requiredDwc }} (you have {{ update.runningDwc }})</div>
							</v-alert>
							<v-alert v-else-if="update && update.scenario === 'upToDate'" type="success" density="compact" class="mb-2">
								Up to date (v{{ update.currentVersion }})
							</v-alert>
							<v-switch :model-value="checksEnabled" color="primary" density="compact" hide-details
									  label="Check for updates on load" @update:model-value="onToggleChecks" />

							<v-divider class="my-4" />
							<div class="text-subtitle-2 mb-1">Diagnostics</div>
							<div class="d-flex flex-wrap ga-2">
								<v-btn variant="tonal" prepend-icon="mdi-download" @click="downloadDiagnostics">Download report</v-btn>
								<v-btn variant="tonal" prepend-icon="mdi-content-copy" @click="copyDiagnostics">Copy report</v-btn>
							</div>
						</v-card-text>
					</v-tabs-window-item>
				</v-tabs-window>
			</v-card>
		</v-col>
	</v-row>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";

import HelpTip from "./HelpTip.vue";
import i18n from "@/i18n";
import { useMachineStore } from "@/stores/machine";
import { LogLevel, useUiStore } from "@/stores/ui";

import { buildReport, copyReport, downloadReport } from "dwc-plugin-runtime";

import { computeAutotune, computeThresholds, type AutotuneResult, type MotorInput, type TuningMode } from "./model/autotune";
import { type AdvancedPlan, buildConfigBlock, buildReadCommands, buildRegisterWrites, type CurrentRegisters } from "./model/apply";
import { DRIVER_FAMILIES, familyForChip, supportedFamilies, supportsCoolStep } from "./model/drivers";
import { LS_STATE, PLUGIN_MANIFEST_ID } from "./model/constants";
import { chipFromIoin, discoverDrivers, IOIN_ADDRESSES, parseRegisterValue, peakToRms, readRunCurrent, readVin } from "./model/machine";
import { MOTOR_DATABASE, type MotorSpec } from "./model/motorDatabase";
import { emptyStore, loadStore, saveStore, type TunerStore } from "./model/storage";
import { decodeFields } from "./model/registers";
import {
	applying, applyUpdateNow, checking, dismissCurrentUpdate, pendingReload,
	runUpdateCheck, setUpdateChecksEnabled, updateChecksEnabled, updateState as update,
} from "./model/updateCheck";

const machineStore = useMachineStore();
const uiStore = useUiStore();

const CUSTOM = "__custom__";
const tab = ref("tune");

// Relevant Duet documentation pages, linked from the field help icons.
const DOC = {
	gcodes: "https://docs.duet3d.com/en/User_manual/Reference/Gcodes",
	tuning: "https://docs.duet3d.com/en/User_manual/Connecting_hardware/Motors_tuning",
	stall: "https://docs.duet3d.com/en/User_manual/Connecting_hardware/Sensors_stall_detection",
};
const motorCount = MOTOR_DATABASE.length;

// ── Persistent store kept on the printer (custom motors + per-driver assignments) ──────────────
const SAVED = "__saved__";
const store = ref<TunerStore>(emptyStore());
let restoring = false; // suppresses assignment auto-save while we restore a driver's saved selection

// ── Motor selection ────────────────────────────────────────────────────────────────────────────
const vendors = Array.from(new Set(MOTOR_DATABASE.map((m) => m.vendor))).sort();
const vendorItems = computed(() => [
	...(store.value.customMotors.length ? [{ title: "★ Saved (on printer)", value: SAVED }] : []),
	...vendors.map((v) => ({ title: v, value: v })),
	{ title: "Custom (enter specs)", value: CUSTOM },
]);
const vendor = ref(vendors[0] ?? CUSTOM);
const motorId = ref<string | null>(null);
// Custom motor: values are entered in the user-selected units below and converted to base (Ω, H, Nm,
// A) for the engine — datasheets quote inductance in mH and torque in N·cm or kgf·cm, so let them pick.
const custom = reactive({ resistance: 1.5, inductance: 1.5, holdingTorque: 40, maxCurrent: 1.5, stepsPerRev: 200 });
const customUnits = reactive({ inductance: "mH", holdingTorque: "Ncm", current: "A" });
const inductanceUnits = [{ title: "mH", value: "mH" }, { title: "µH", value: "uH" }, { title: "H", value: "H" }];
const torqueUnits = [{ title: "N·cm", value: "Ncm" }, { title: "kgf·cm", value: "kgfcm" }, { title: "mN·m", value: "mNm" }, { title: "N·m", value: "Nm" }];
const currentUnits = [{ title: "A", value: "A" }, { title: "mA", value: "mA" }];
const IND_FACTOR: Record<string, number> = { H: 1, mH: 1e-3, uH: 1e-6 };
const TORQUE_FACTOR: Record<string, number> = { Nm: 1, Ncm: 0.01, kgfcm: 0.0980665, mNm: 1e-3 };
const CURRENT_FACTOR: Record<string, number> = { A: 1, mA: 1e-3 };

/** Custom motor converted to base units (Ω, H, Nm, A). */
const customBase = computed<MotorInput>(() => ({
	resistance: custom.resistance,
	inductance: custom.inductance * (IND_FACTOR[customUnits.inductance] ?? 1),
	holdingTorque: custom.holdingTorque * (TORQUE_FACTOR[customUnits.holdingTorque] ?? 1),
	maxCurrent: custom.maxCurrent * (CURRENT_FACTOR[customUnits.current] ?? 1),
	stepsPerRev: custom.stepsPerRev,
}));
const customBaseSummary = computed(() => {
	const b = customBase.value;
	return `${b.resistance} Ω · ${(b.inductance * 1000).toFixed(3)} mH · ${b.holdingTorque.toFixed(3)} Nm · ${b.maxCurrent.toFixed(2)} A`;
});

const motorItems = computed(() => {
	const list = vendor.value === SAVED
		? store.value.customMotors.map((m) => ({ title: m.id, value: m.id }))
		: MOTOR_DATABASE.filter((m) => m.vendor === vendor.value).map((m) => ({ title: m.id, value: m.id }));
	return list.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }));
});

watch(vendor, () => {
	// Keep the current motor if it belongs to the new vendor (so restoring a saved selection isn't
	// clobbered); otherwise default to the first.
	if (vendor.value !== CUSTOM && !motorItems.value.some((x) => x.value === motorId.value)) {
		motorId.value = motorItems.value[0]?.value ?? null;
	}
});

/** Select a motor by id across the database and the saved (on-printer) motors, setting its vendor. */
function selectMotorById(id: string): void {
	const dbm = MOTOR_DATABASE.find((m) => m.id === id);
	if (dbm) { vendor.value = dbm.vendor; motorId.value = id; return; }
	if (store.value.customMotors.some((m) => m.id === id)) { vendor.value = SAVED; motorId.value = id; }
}

const selectedMotor = computed(() =>
	MOTOR_DATABASE.find((m) => m.id === motorId.value) ?? store.value.customMotors.find((m) => m.id === motorId.value) ?? null);
const motorHint = computed(() => {
	const m = selectedMotor.value;
	return m ? `${m.resistance} Ω · ${(m.inductance * 1000).toFixed(2)} mH · ${m.holdingTorque} Nm · ${m.maxCurrent} A · ${m.stepsPerRev} steps` : "";
});

const motorInput = computed<MotorInput | null>(() => {
	const m = vendor.value === CUSTOM ? customBase.value : selectedMotor.value;
	if (!m) return null;
	const valid = [m.resistance, m.inductance, m.holdingTorque, m.maxCurrent, m.stepsPerRev].every((n) => typeof n === "number" && Number.isFinite(n) && n > 0);
	return valid ? { resistance: m.resistance, inductance: m.inductance, holdingTorque: m.holdingTorque, maxCurrent: m.maxCurrent, stepsPerRev: m.stepsPerRev } : null;
});

// ── Driver selection ───────────────────────────────────────────────────────────────────────────
const chipItems = supportedFamilies().flatMap((f) => f.chips.map((c) => ({ title: c, value: c })));
const chip = ref("TMC2209");
const family = computed(() => familyForChip(chip.value) ?? DRIVER_FAMILIES.tmc22xx);
// Every physical driver across all boards (main + expansion + toolboards), with its inferred family.
const detected = computed(() => discoverDrivers(machineStore.model));
// Items carry the discovered label (which leads with the mapped axis, e.g. "X — TMC5160 (0.0)") as the
// title, but the model value stays the bare M569.2 P id so free-typing a P value still works.
const driverItems = computed(() => detected.value.map((d) => ({ title: d.label, value: d.id })));
const driver = ref<string>("0.0");
// RRF reports peak current; the autotune uses RMS. Surface the conversion so it's never a surprise.
const currentNote = computed(() => {
	if (runCurrent.value && runCurrent.value > 0) {
		return `Run current ${runCurrent.value} A peak → ${peakToRms(runCurrent.value).toFixed(2)} A RMS used for tuning (RRF is peak; clear to use the motor's rated current).`;
	}
	return "Using the motor's rated current. RRF/M906 current is peak — entered run current is ÷√2 to RMS for the maths.";
});
const detectedHint = computed(() => {
	const d = detected.value.find((x) => x.id === driver.value);
	if (!d) return detected.value.length ? "Not a detected driver — check the P value." : "Connect to auto-detect drivers, or type the M569.2 P value.";
	const axis = d.assignedTo ? `Axis ${d.assignedTo} · ` : "Unassigned · ";
	if (!d.tuneable) return `${axis}${d.chip ?? "External"} on ${d.board} — not tuneable via M569.2.`;
	// Show the effective (selected/detected) chip; note when the board didn't auto-identify it.
	const note = d.chip ? "" : " · chip not auto-detected — use Detect chip to confirm";
	return `${axis}${chip.value} on ${d.board}${note}`;
});
const volts = ref<number>(24);
const runCurrent = ref<number | null>(null);
const fclk = ref<number>(DRIVER_FAMILIES.tmc22xx.fclk);
const toff = ref<number>(3);
const tbl = ref<number>(1);
const extraHysteresis = ref<number>(0);
const pwmFreqTargetHz = ref<number>(55000);
// Hysteresis maths basis: "rms" (Klipper/validated default) or "peak" (Trinamic calc-sheet exact).
const hysteresisBasis = ref<"rms" | "peak">("rms");
const currentScaleCs = ref<number>(31);
const hysteresisBasisItems = [
	{ title: "RMS current (Klipper, default)", value: "rms" },
	{ title: "Peak current (Trinamic exact)", value: "peak" },
];
const mode = ref<TuningMode>("chopperOnly");
const modeItems = [
	{ title: "Chopper & PWM only (no thresholds)", value: "chopperOnly" },
	{ title: "Silent — stealthChop always", value: "silent" },
	{ title: "Performance — spreadCycle", value: "performance" },
	{ title: "Auto (silent for high-torque motors)", value: "auto" },
	{ title: "Auto-switch at speed", value: "autoSwitch" },
];

// CoolStep + StallGuard (opt-in; off by default — they change current behaviour / sensorless homing).
const coolStep = ref(false);
const stallGuard = ref(false);
const sgValue = ref<number>(DRIVER_FAMILIES.tmc22xx.stallGuard.default);
const advancedSupported = computed(() => supportsCoolStep(chip.value));
const sgRange = computed(() => {
	const sg = family.value.stallGuard;
	return { min: sg.min, max: sg.max, label: sg.kind === "sgthrs" ? "SGTHRS (0–255)" : "SGT (−64…63)" };
});

// When the chip changes, snap fclk + PWM-freq target + StallGuard default to that family's values.
watch(chip, () => {
	fclk.value = family.value.fclk;
	pwmFreqTargetHz.value = family.value.pwmFreqTarget;
	sgValue.value = family.value.stallGuard.default;
	if (!advancedSupported.value) {
		coolStep.value = false;
		stallGuard.value = false;
	}
});

const initialized = ref(false);

/** Apply a driver's context: restore its saved/board chip + motor, read its run current, auto-detect. */
function applyDriverContext(id: string): void {
	const a = store.value.assignments[id];
	const d = detected.value.find((x) => x.id === id);
	restoring = true;
	try {
		// Prefer a remembered (saved-on-printer) assignment, else the board-inferred chip.
		if (a?.chip) chip.value = a.chip;
		else if (d?.chip) chip.value = d.chip;
		if (a?.motorId) selectMotorById(a.motorId);
	} finally {
		restoring = false;
	}
	const rc = readRunCurrent(machineStore.model, id);
	if (rc) runCurrent.value = rc;
	void autoReadDriver(); // identify chip + read live registers as soon as a driver is chosen
}

// React to a USER changing the driver (init handles the first apply explicitly, in order).
watch(driver, (id) => {
	if (initialized.value) applyDriverContext(id);
});

const isConnected = computed(() => machineStore.isConnected);

// ── Compute ────────────────────────────────────────────────────────────────────────────────────
const result = computed<AutotuneResult | null>(() => {
	const m = motorInput.value;
	if (!m || !(volts.value > 0) || !(fclk.value > 0)) return null;
	try {
		return computeAutotune(m, {
			volts: volts.value, fclk: fclk.value,
			// runCurrent from RRF is PEAK (M906); convert to RMS for the formulas. Cleared = use rated.
			runCurrent: runCurrent.value && runCurrent.value > 0 ? peakToRms(runCurrent.value) : undefined,
			toff: toff.value, tbl: tbl.value, extraHysteresis: extraHysteresis.value,
			blankCycles: family.value.blankCycles,
			hysteresisBasis: hysteresisBasis.value, currentScaleCs: currentScaleCs.value,
			pwmFreqTargetHz: pwmFreqTargetHz.value,
		});
	} catch {
		return null;
	}
});

const currentRegs = ref<CurrentRegisters>({});
const hasRead = computed(() => currentRegs.value.chopconf !== undefined || currentRegs.value.pwmconf !== undefined);

const thresholds = computed(() => {
	const r = result.value;
	const m = motorInput.value;
	if (!r || !m) return undefined;
	return computeThresholds({
		mode: mode.value, fclk: fclk.value, stepsPerRev: m.stepsPerRev,
		holdingTorque: m.holdingTorque, maxpwmrps: r.maxpwmrps,
		hasSg4: family.value.hasSg4, hasThigh: !!family.value.thigh,
	});
});
const advancedPlan = computed<AdvancedPlan | undefined>(() => {
	if (!advancedSupported.value || (!coolStep.value && !stallGuard.value)) return undefined;
	const m = motorInput.value;
	if (!m) return undefined;
	return { coolStep: coolStep.value, stallGuard: stallGuard.value, fclk: fclk.value, stepsPerRev: m.stepsPerRev, sgValue: sgValue.value };
});
const writes = computed(() => (result.value ? buildRegisterWrites(family.value, driver.value, result.value, currentRegs.value, thresholds.value, advancedPlan.value) : []));

const configBlock = computed(() => buildConfigBlock(writes.value, {
	driver: driver.value, chip: chip.value, motor: vendor.value === CUSTOM ? "custom motor" : motorId.value ?? undefined, volts: volts.value,
}));

function hex(word: number): string {
	return (word >>> 0).toString(16).toUpperCase().padStart(8, "0");
}
function fieldSummary(register: string): string {
	const w = writes.value.find((x) => x.register === register);
	if (!w || !result.value) return "";
	if (register === "CHOPCONF") {
		const f = decodeFields(family.value.registers.chopconf, w.word);
		// Show LOGICAL hstrt/hend (the datasheet values), not the offset-encoded field values.
		return `toff ${f.toff}, tbl ${f.tbl}, hstrt ${f.hstrt + 1}, hend ${f.hend - 3}`;
	}
	if (register === "PWMCONF") {
		const f = decodeFields(family.value.registers.pwmconf, w.word);
		return `ofs ${f.pwm_ofs}, grad ${f.pwm_grad}, freq ${f.pwm_freq}, autoscale ${f.pwm_autoscale}, autograd ${f.pwm_autograd}`;
	}
	if (register === "COOLCONF") {
		const f = decodeFields(family.value.coolconf, w.word);
		const sgt = "sgt" in f ? `, sgt ${(f.sgt << 25) >> 25}` : ""; // sign-extend 7-bit
		return `semin ${f.semin}, semax ${f.semax}, seup ${f.seup}, sedn ${f.sedn}, seimin ${f.seimin}${sgt}`;
	}
	if (register === "SGTHRS") {
		return `SGTHRS ${w.word >>> 0}`;
	}
	// TPWMTHRS / TCOOLTHRS / THIGH: a single TSTEP threshold value (0 = always stealthChop; max = off).
	return `TSTEP ${w.word >>> 0}`;
}

// ── Board interaction ─────────────────────────────────────────────────────────────────────────
const reading = ref(false);
const applyingRegs = ref(false);
const detecting = ref(false);
const busy = computed(() => reading.value || applyingRegs.value || detecting.value);
const copied = ref(false);

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Read one driver register word over M569.2 for the selected driver. */
async function readReg(addr: number): Promise<number | null> {
	return parseRegisterValue(await machineStore.sendCode(`M569.2 P${driver.value} R${addr}`, false, false));
}

// Identify the chip on the selected driver by reading its IOIN VERSION byte (the reliable way on the
// STM32 port, where the object model doesn't carry the chip type). The FIRST M569.2 read after a page
// load is often stale (RRF returns a cached/empty value before the driver is actually read), so we
// retry a few times until the version byte resolves to a known chip.
async function detectChip(): Promise<void> {
	if (!isConnected.value) return;
	detecting.value = true;
	try {
		const title = i18n.global.t("plugins.duetTmcTuner.title");
		let match: ReturnType<typeof chipFromIoin> = null;
		for (let attempt = 0; attempt < 4 && !match; attempt++) {
			if (attempt > 0) await sleepMs(200);
			const uart = await readReg(IOIN_ADDRESSES.uart);
			const spi = await readReg(IOIN_ADDRESSES.spi);
			match = chipFromIoin({ uart, spi });
		}
		if (match) {
			chip.value = match.chip;
			uiStore.makeNotification(LogLevel.success, title, `Detected ${match.chip} on driver ${driver.value}.`);
		} else {
			uiStore.makeNotification(LogLevel.warning, title, `Couldn't identify the chip on driver ${driver.value} — pick it manually.`);
		}
	} catch (e) {
		uiStore.makeNotification(LogLevel.error, i18n.global.t("plugins.duetTmcTuner.title"), (e as Error)?.message ?? String(e));
	} finally {
		detecting.value = false;
	}
}

async function readBack(): Promise<void> {
	if (!isConnected.value) return;
	reading.value = true;
	try {
		const [chopCmd, pwmCmd] = buildReadCommands(family.value, driver.value);
		// Prime: the first M569.2 read after a page load can be stale — discard one, then read for real.
		await machineStore.sendCode(chopCmd, false, false);
		const chopReply = await machineStore.sendCode(chopCmd, false, false);
		const pwmReply = await machineStore.sendCode(pwmCmd, false, false);
		currentRegs.value = {
			chopconf: parseRegisterValue(chopReply) ?? undefined,
			pwmconf: parseRegisterValue(pwmReply) ?? undefined,
		};
		if (!hasRead.value) {
			uiStore.makeNotification(LogLevel.warning, i18n.global.t("plugins.duetTmcTuner.title"), "Couldn't parse the register read-back — check the driver number.");
		}
	} catch (e) {
		uiStore.makeNotification(LogLevel.error, i18n.global.t("plugins.duetTmcTuner.title"), (e as Error)?.message ?? String(e));
	} finally {
		reading.value = false;
	}
}

async function applyNow(): Promise<void> {
	if (!isConnected.value || !writes.value.length) return;
	applyingRegs.value = true;
	try {
		for (const w of writes.value) {
			await machineStore.sendCode(w.command, false, false);
		}
		uiStore.makeNotification(LogLevel.success, i18n.global.t("plugins.duetTmcTuner.title"), `Wrote ${writes.value.length} register(s) to driver ${driver.value}.`);
	} catch (e) {
		uiStore.makeNotification(LogLevel.error, i18n.global.t("plugins.duetTmcTuner.title"), (e as Error)?.message ?? String(e));
	} finally {
		applyingRegs.value = false;
	}
}

// Auto-identify the chip and read the live registers when a driver is chosen (best-effort).
let autoReadToken = 0;
async function autoReadDriver(): Promise<void> {
	if (!isConnected.value || busy.value) return;
	const token = ++autoReadToken;
	await detectChip();
	if (token !== autoReadToken) return; // a newer driver selection superseded this one
	await readBack();
}

// ── Persistence to the printer: remember the motor/chip per driver, and saved custom motors ──────
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persistStore(): void {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => { void saveStore(store.value); }, 500);
}
// Remember the selected motor + chip against the current driver (skipped while restoring).
watch([motorId, chip, vendor], () => {
	if (!initialized.value || restoring || !driver.value) return;
	store.value.assignments[driver.value] = {
		motorId: vendor.value === CUSTOM ? undefined : motorId.value ?? undefined,
		chip: chip.value,
	};
	persistStore();
});

const saveMotorDialog = ref(false);
const saveMotorName = ref("");
function openSaveMotor(): void {
	saveMotorName.value = "";
	saveMotorDialog.value = true;
}
function confirmSaveMotor(): void {
	const name = saveMotorName.value.trim();
	const b = customBase.value;
	if (!name || !motorInput.value) return;
	const spec: MotorSpec = { id: name, vendor: "Saved", resistance: b.resistance, inductance: b.inductance, holdingTorque: b.holdingTorque, maxCurrent: b.maxCurrent, stepsPerRev: b.stepsPerRev };
	const existing = store.value.customMotors.findIndex((m) => m.id === name);
	if (existing >= 0) store.value.customMotors.splice(existing, 1, spec);
	else store.value.customMotors.push(spec);
	persistStore();
	saveMotorDialog.value = false;
	vendor.value = SAVED;
	motorId.value = name;
	uiStore.makeNotification(LogLevel.success, i18n.global.t("plugins.duetTmcTuner.title"), `Saved "${name}" to the printer.`);
}
/** Klipper-style cfg entry, for contributing a motor to the shared database via PR. */
function copyMotorForSharing(): void {
	const b = customBase.value;
	const name = (motorId.value || saveMotorName.value || "my-motor").trim();
	const cfg = `[motor_constants ${name}]\nresistance: ${b.resistance}\ninductance: ${b.inductance}\nholding_torque: ${b.holdingTorque}\nmax_current: ${b.maxCurrent}\nsteps_per_revolution: ${b.stepsPerRev}`;
	if (navigator.clipboard) void navigator.clipboard.writeText(cfg).then(() => { copied.value = true; });
}

function resetToDefault(): void {
	vendor.value = vendors[0] ?? CUSTOM;
	motorId.value = motorItems.value[0]?.value ?? null;
	chip.value = "TMC2209";
	volts.value = Math.round(readVin(machineStore.model) ?? 24);
	runCurrent.value = null;
	fclk.value = family.value.fclk;
	toff.value = 3; tbl.value = 1; extraHysteresis.value = 0; pwmFreqTargetHz.value = family.value.pwmFreqTarget;
	mode.value = "chopperOnly";
	hysteresisBasis.value = "rms"; currentScaleCs.value = 31;
	coolStep.value = false; stallGuard.value = false; sgValue.value = family.value.stallGuard.default;
	currentRegs.value = {};
	try { localStorage.removeItem(LS_STATE); } catch { /* ignore */ }
	uiStore.makeNotification(LogLevel.info, i18n.global.t("plugins.duetTmcTuner.title"), "Reset to defaults (saved motors & assignments kept).");
}

function copyBlock(): void {
	const text = configBlock.value;
	if (navigator.clipboard) {
		void navigator.clipboard.writeText(text).then(() => { copied.value = true; });
	} else {
		const ta = document.createElement("textarea");
		ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
		document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
		copied.value = true;
	}
}

// A live read is only valid for the driver/chip it was taken from; drop it when those change.
watch([driver, chip], () => { currentRegs.value = {}; });

// ── Updates + diagnostics ──────────────────────────────────────────────────────────────────────
const checksEnabled = ref(updateChecksEnabled());
function checkNow(): void { void runUpdateCheck({ force: true }); }
function updateNow(): void { void applyUpdateNow(); }
function dismissUpdate(): void { dismissCurrentUpdate(); }
function reloadPage(): void { window.location.reload(); }
function onToggleChecks(value: boolean | null): void {
	const on = value === true;
	checksEnabled.value = on;
	setUpdateChecksEnabled(on);
	if (on) void runUpdateCheck({ force: true });
}
function diagnosticReport() {
	return buildReport({
		pluginId: PLUGIN_MANIFEST_ID,
		model: machineStore.model,
		state: { chip: chip.value, driver: driver.value, volts: volts.value, fclk: fclk.value, motor: motorId.value, writes: writes.value },
	});
}
function downloadDiagnostics(): void { downloadReport(diagnosticReport()); }
async function copyDiagnostics(): Promise<void> {
	const ok = await copyReport(diagnosticReport());
	uiStore.makeNotification(ok ? LogLevel.success : LogLevel.warning, i18n.global.t("plugins.duetTmcTuner.title"),
		i18n.global.t(ok ? "plugins.duetTmcTuner.diagnostics.copied" : "plugins.duetTmcTuner.diagnostics.copyFailed"));
}

// ── Persistence + initial OM-derived defaults ──────────────────────────────────────────────────
watch([vendor, motorId, chip, driver, volts, fclk, toff, tbl, extraHysteresis, pwmFreqTargetHz, mode, hysteresisBasis, currentScaleCs, coolStep, stallGuard, sgValue, custom, customUnits], () => {
	try {
		localStorage.setItem(LS_STATE, JSON.stringify({
			vendor: vendor.value, motorId: motorId.value, chip: chip.value, driver: driver.value,
			volts: volts.value, fclk: fclk.value, toff: toff.value, tbl: tbl.value,
			extraHysteresis: extraHysteresis.value, pwmFreqTargetHz: pwmFreqTargetHz.value, mode: mode.value,
			hysteresisBasis: hysteresisBasis.value, currentScaleCs: currentScaleCs.value,
			coolStep: coolStep.value, stallGuard: stallGuard.value, sgValue: sgValue.value,
			custom: { ...custom }, customUnits: { ...customUnits },
		}));
	} catch { /* storage disabled */ }
}, { deep: true });

onMounted(async () => {
	try {
		const saved = localStorage.getItem(LS_STATE);
		if (saved) {
			const s = JSON.parse(saved);
			if (s.vendor) vendor.value = s.vendor;
			if (s.motorId) motorId.value = s.motorId;
			if (s.chip) chip.value = s.chip;
			if (s.driver) driver.value = s.driver;
			if (typeof s.volts === "number") volts.value = s.volts;
			if (typeof s.fclk === "number") fclk.value = s.fclk;
			if (typeof s.toff === "number") toff.value = s.toff;
			if (typeof s.tbl === "number") tbl.value = s.tbl;
			if (typeof s.extraHysteresis === "number") extraHysteresis.value = s.extraHysteresis;
			if (typeof s.pwmFreqTargetHz === "number") pwmFreqTargetHz.value = s.pwmFreqTargetHz;
			if (typeof s.mode === "string") mode.value = s.mode;
			if (s.hysteresisBasis === "rms" || s.hysteresisBasis === "peak") hysteresisBasis.value = s.hysteresisBasis;
			if (typeof s.currentScaleCs === "number") currentScaleCs.value = s.currentScaleCs;
			if (typeof s.coolStep === "boolean") coolStep.value = s.coolStep;
			if (typeof s.stallGuard === "boolean") stallGuard.value = s.stallGuard;
			if (typeof s.sgValue === "number") sgValue.value = s.sgValue;
			if (s.custom) Object.assign(custom, s.custom);
			if (s.customUnits) Object.assign(customUnits, s.customUnits);
		}
	} catch { /* ignore */ }

	// Load the durable, on-printer store (custom motors + per-driver assignments) before we settle the
	// driver, so assignments can be applied.
	store.value = await loadStore();

	const vin = readVin(machineStore.model);
	if (vin) volts.value = Math.round(vin);
	if (!motorId.value && vendor.value !== CUSTOM && vendor.value !== SAVED) motorId.value = motorItems.value[0]?.value ?? null;

	// Settle the active driver (prefer the saved/last one if still present, else the first tuneable).
	const tuneable = detected.value.filter((d) => d.tuneable);
	if (tuneable.length && !tuneable.some((d) => d.id === driver.value)) {
		driver.value = tuneable[0].id;
	}
	// Apply its context once (assignment + auto-read), then enable the reactive watchers.
	applyDriverContext(driver.value);
	initialized.value = true;
});
</script>

<style scoped>
.reg-table :deep(td), .reg-table :deep(th) {
	font-size: 0.82em;
	padding: 2px 8px !important;
}
.reg-table :deep(code) {
	font-size: 0.95em;
}
.config-block {
	font-family: monospace;
	font-size: 0.82em;
	background: rgba(128, 128, 128, 0.15);
	border-radius: 4px;
	padding: 10px 12px;
	white-space: pre-wrap;
	word-break: break-all;
}
</style>
