/**
 * Duet TMC Tuner — entry point.
 *
 * Registers a standalone DWC page (Plugins → TMC Tuner) that computes good TMC stepper-driver chopper
 * and PWM register values from a motor's electrical constants and writes them DIRECTLY to the driver
 * registers via `M569.2`. Wires in the shared runtime (self-update hub + error capture) and tears down
 * app-lifetime resources on `dwcPluginUnloaded`.
 */
import { registerPluginMessages, registerRoute, unregisterRoute } from "@/plugins";
import Events from "@/utils/events";
import { clearAnnouncedUpdate, installErrorCapture } from "dwc-plugin-runtime";

import DuetTmcTuner from "./DuetTmcTuner.vue";
import { PLUGIN_ID, PLUGIN_MANIFEST_ID, ROUTE_PATH } from "./model/constants";
import { runUpdateCheck } from "./model/updateCheck";
import en from "./i18n/en.json";

registerPluginMessages(PLUGIN_ID, { en });

registerRoute(DuetTmcTuner, {
	Plugins: {
		DuetTmcTuner: {
			icon: "mdi-tune-vertical",
			caption: "plugins.duetTmcTuner.menuCaption",
			path: ROUTE_PATH,
		},
	},
});

const uninstallErrorCapture = installErrorCapture();

setTimeout(() => { void runUpdateCheck({ notify: true }); }, 4000);

function onPluginUnloaded(id: string): void {
	if (id === PLUGIN_MANIFEST_ID) {
		unregisterRoute(ROUTE_PATH);
		clearAnnouncedUpdate(PLUGIN_MANIFEST_ID);
		uninstallErrorCapture();
		Events.off("dwcPluginUnloaded", onPluginUnloaded);
	}
}
Events.on("dwcPluginUnloaded", onPluginUnloaded);
