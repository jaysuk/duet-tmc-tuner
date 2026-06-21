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

							<v-row>
								<!-- Motor -->
								<v-col cols="12" md="6">
									<div class="text-subtitle-2 mb-2">Motor</div>
									<v-select v-model="vendor" :items="vendorItems" label="Manufacturer" density="compact"
											  variant="outlined" hide-details class="mb-2" />
									<v-select v-if="vendor !== CUSTOM" v-model="motorId" :items="motorItems" label="Motor"
											  density="compact" variant="outlined" hide-details
											  :hint="motorHint" persistent-hint class="mb-2" />
									<template v-else>
										<v-row dense>
											<v-col cols="6"><v-text-field v-model.number="custom.resistance" type="number" label="Resistance (Ω)" density="compact" variant="outlined" hide-details /></v-col>
											<v-col cols="6"><v-text-field v-model.number="custom.inductance" type="number" label="Inductance (H)" density="compact" variant="outlined" hide-details /></v-col>
											<v-col cols="6"><v-text-field v-model.number="custom.holdingTorque" type="number" label="Holding torque (Nm)" density="compact" variant="outlined" hide-details /></v-col>
											<v-col cols="6"><v-text-field v-model.number="custom.maxCurrent" type="number" label="Rated current (A)" density="compact" variant="outlined" hide-details /></v-col>
											<v-col cols="6"><v-text-field v-model.number="custom.stepsPerRev" type="number" label="Steps / rev" density="compact" variant="outlined" hide-details /></v-col>
										</v-row>
									</template>
								</v-col>

								<!-- Driver -->
								<v-col cols="12" md="6">
									<div class="text-subtitle-2 mb-2">Driver</div>
									<v-row dense>
										<v-col cols="6"><v-combobox v-model="driver" :items="driverIdItems" label="Driver (M569.2 P)" :hint="detectedHint" persistent-hint density="compact" variant="outlined" /></v-col>
										<v-col cols="6"><v-select v-model="chip" :items="chipItems" label="Driver chip" density="compact" variant="outlined" hide-details /></v-col>
										<v-col cols="4"><v-text-field v-model.number="volts" type="number" label="Voltage (V)" density="compact" variant="outlined" hide-details class="mt-2" /></v-col>
										<v-col cols="4"><v-text-field v-model.number="runCurrent" type="number" label="Run current (A peak)" density="compact" variant="outlined" hide-details clearable placeholder="rated" class="mt-2" /></v-col>
										<v-col cols="4"><v-text-field v-model.number="fclk" type="number" label="Clock (Hz)" density="compact" variant="outlined" hide-details class="mt-2" /></v-col>
									</v-row>
									<div class="text-caption text-medium-emphasis mt-1">
										Drivers on the mainboard, expansion and toolboards are auto-detected from the object model.
									</div>
									<div class="text-caption text-medium-emphasis">{{ currentNote }}</div>
									<v-select v-model="mode" :items="modeItems" label="Tuning mode" density="compact" variant="outlined"
											  hide-details class="mt-2"
											  hint="Adds the stealthChop↔spreadCycle velocity thresholds (TPWMTHRS/THIGH). Needs M569 stealthChop (D3) enabled to take effect." persistent-hint />
									<v-expansion-panels class="mt-2" variant="accordion">
										<v-expansion-panel title="Advanced (chopper)">
											<v-expansion-panel-text>
												<v-row dense>
													<v-col cols="3"><v-text-field v-model.number="toff" type="number" label="TOFF (1–15)" density="compact" variant="outlined" hide-details /></v-col>
													<v-col cols="3"><v-text-field v-model.number="tbl" type="number" label="TBL (0–3)" density="compact" variant="outlined" hide-details /></v-col>
													<v-col cols="3"><v-text-field v-model.number="extraHysteresis" type="number" label="Extra hyst." density="compact" variant="outlined" hide-details /></v-col>
													<v-col cols="3"><v-text-field v-model.number="pwmFreqTargetHz" type="number" label="PWM Hz" density="compact" variant="outlined" hide-details /></v-col>
												</v-row>
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
									<v-btn size="small" color="primary" prepend-icon="mdi-upload-network" :disabled="!isConnected || busy"
										   :loading="applyingRegs" @click="applyNow">Apply now</v-btn>
								</div>

								<v-alert v-if="!hasRead" type="info" density="compact" variant="tonal" class="mb-3">
									No live read yet — the words below assume all other bits are 0. Click
									<strong>Read current registers</strong> (connected) for an accurate read-modify-write.
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

import i18n from "@/i18n";
import { useMachineStore } from "@/stores/machine";
import { LogLevel, useUiStore } from "@/stores/ui";

import { buildReport, copyReport, downloadReport } from "dwc-plugin-runtime";

import { computeAutotune, computeThresholds, type AutotuneResult, type MotorInput, type TuningMode } from "./model/autotune";
import { buildConfigBlock, buildReadCommands, buildRegisterWrites, type CurrentRegisters } from "./model/apply";
import { DRIVER_FAMILIES, familyForChip, supportedFamilies } from "./model/drivers";
import { LS_STATE, PLUGIN_MANIFEST_ID } from "./model/constants";
import { chipFromIoin, discoverDrivers, IOIN_ADDRESSES, parseRegisterValue, peakToRms, readRunCurrent, readVin } from "./model/machine";
import { MOTOR_DATABASE } from "./model/motorDatabase";
import { decodeFields } from "./model/registers";
import {
	applying, applyUpdateNow, checking, dismissCurrentUpdate, pendingReload,
	runUpdateCheck, setUpdateChecksEnabled, updateChecksEnabled, updateState as update,
} from "./model/updateCheck";

const machineStore = useMachineStore();
const uiStore = useUiStore();

const CUSTOM = "__custom__";
const tab = ref("tune");
const motorCount = MOTOR_DATABASE.length;

// ── Motor selection ────────────────────────────────────────────────────────────────────────────
const vendors = Array.from(new Set(MOTOR_DATABASE.map((m) => m.vendor))).sort();
const vendorItems = [...vendors.map((v) => ({ title: v, value: v })), { title: "Custom (enter specs)", value: CUSTOM }];
const vendor = ref(vendors[0] ?? CUSTOM);
const motorId = ref<string | null>(null);
const custom = reactive<MotorInput>({ resistance: 1.5, inductance: 0.0015, holdingTorque: 0.4, maxCurrent: 1.5, stepsPerRev: 200 });

const motorItems = computed(() =>
	MOTOR_DATABASE.filter((m) => m.vendor === vendor.value).map((m) => ({ title: m.id, value: m.id })));

watch(vendor, () => {
	if (vendor.value !== CUSTOM) {
		motorId.value = motorItems.value[0]?.value ?? null;
	}
});

const selectedMotor = computed(() => MOTOR_DATABASE.find((m) => m.id === motorId.value) ?? null);
const motorHint = computed(() => {
	const m = selectedMotor.value;
	return m ? `${m.resistance} Ω · ${(m.inductance * 1000).toFixed(2)} mH · ${m.holdingTorque} Nm · ${m.maxCurrent} A · ${m.stepsPerRev} steps` : "";
});

const motorInput = computed<MotorInput | null>(() => {
	const m = vendor.value === CUSTOM ? custom : selectedMotor.value;
	if (!m) return null;
	const valid = [m.resistance, m.inductance, m.holdingTorque, m.maxCurrent, m.stepsPerRev].every((n) => typeof n === "number" && n > 0);
	return valid ? { resistance: m.resistance, inductance: m.inductance, holdingTorque: m.holdingTorque, maxCurrent: m.maxCurrent, stepsPerRev: m.stepsPerRev } : null;
});

// ── Driver selection ───────────────────────────────────────────────────────────────────────────
const chipItems = supportedFamilies().flatMap((f) => f.chips.map((c) => ({ title: c, value: c })));
const chip = ref("TMC2209");
const family = computed(() => familyForChip(chip.value) ?? DRIVER_FAMILIES.tmc22xx);
// Every physical driver across all boards (main + expansion + toolboards), with its inferred family.
const detected = computed(() => discoverDrivers(machineStore.model));
const driverIdItems = computed(() => detected.value.map((d) => d.id));
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
	if (!d.tuneable) return `${d.chip ?? "External"} on ${d.board} — not tuneable via M569.2.`;
	return `${d.chip} on ${d.board}${d.assignedTo ? ` (${d.assignedTo})` : ""}`;
});
const volts = ref<number>(24);
const runCurrent = ref<number | null>(null);
const fclk = ref<number>(DRIVER_FAMILIES.tmc22xx.fclk);
const toff = ref<number>(3);
const tbl = ref<number>(1);
const extraHysteresis = ref<number>(0);
const pwmFreqTargetHz = ref<number>(55000);
const mode = ref<TuningMode>("chopperOnly");
const modeItems = [
	{ title: "Chopper & PWM only (no thresholds)", value: "chopperOnly" },
	{ title: "Silent — stealthChop always", value: "silent" },
	{ title: "Performance — spreadCycle", value: "performance" },
	{ title: "Auto (silent for high-torque motors)", value: "auto" },
	{ title: "Auto-switch at speed", value: "autoSwitch" },
];

// When the chip changes, snap fclk + PWM-freq target to that family's defaults.
watch(chip, () => {
	fclk.value = family.value.fclk;
	pwmFreqTargetHz.value = family.value.pwmFreqTarget;
});

// Selecting a detected driver auto-fills its chip (and hence fclk/target) and run current.
watch(driver, (id) => {
	const d = detected.value.find((x) => x.id === id);
	if (d?.chip) chip.value = d.chip;
	const rc = readRunCurrent(machineStore.model, id);
	if (rc) runCurrent.value = rc;
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
const writes = computed(() => (result.value ? buildRegisterWrites(family.value, driver.value, result.value, currentRegs.value, thresholds.value) : []));

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
	// TPWMTHRS / THIGH: a single TSTEP threshold value (0 = always stealthChop; max = effectively off).
	return `TSTEP ${w.word >>> 0}`;
}

// ── Board interaction ─────────────────────────────────────────────────────────────────────────
const reading = ref(false);
const applyingRegs = ref(false);
const detecting = ref(false);
const busy = computed(() => reading.value || applyingRegs.value || detecting.value);
const copied = ref(false);

// Identify the chip on the selected driver by reading its IOIN VERSION byte (the reliable way on the
// STM32 port, where the object model doesn't carry the chip type).
async function detectChip(): Promise<void> {
	if (!isConnected.value) return;
	detecting.value = true;
	try {
		const uartReply = await machineStore.sendCode(`M569.2 P${driver.value} R${IOIN_ADDRESSES.uart}`, false, false);
		const spiReply = await machineStore.sendCode(`M569.2 P${driver.value} R${IOIN_ADDRESSES.spi}`, false, false);
		const match = chipFromIoin({ uart: parseRegisterValue(uartReply), spi: parseRegisterValue(spiReply) });
		const title = i18n.global.t("plugins.duetTmcTuner.title");
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
watch([vendor, motorId, chip, driver, volts, fclk, toff, tbl, extraHysteresis, pwmFreqTargetHz, mode, custom], () => {
	try {
		localStorage.setItem(LS_STATE, JSON.stringify({
			vendor: vendor.value, motorId: motorId.value, chip: chip.value, driver: driver.value,
			volts: volts.value, fclk: fclk.value, toff: toff.value, tbl: tbl.value,
			extraHysteresis: extraHysteresis.value, pwmFreqTargetHz: pwmFreqTargetHz.value, mode: mode.value, custom: { ...custom },
		}));
	} catch { /* storage disabled */ }
}, { deep: true });

onMounted(() => {
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
			if (s.custom) Object.assign(custom, s.custom);
		}
	} catch { /* ignore */ }
	if (!motorId.value && vendor.value !== CUSTOM) motorId.value = motorItems.value[0]?.value ?? null;
	// Seed supply voltage + a default driver from the live machine when available.
	const vin = readVin(machineStore.model);
	if (vin) volts.value = Math.round(vin);
	const drivers = detected.value;
	const tuneable = drivers.filter((d) => d.tuneable);
	if (tuneable.length && !tuneable.some((d) => d.id === driver.value)) {
		driver.value = tuneable[0].id; // triggers the watcher → sets chip + run current
	} else {
		const rc = readRunCurrent(machineStore.model, driver.value);
		if (rc) runCurrent.value = rc;
	}
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
