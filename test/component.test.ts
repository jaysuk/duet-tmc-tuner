import { beforeEach, describe, expect, it } from "vitest";

import { mountInDwc, resetDwc } from "dwc-plugin-test-kit";

import DuetTmcTuner from "../src/DuetTmcTuner.vue";

describe("DuetTmcTuner", () => {
	beforeEach(() => resetDwc());

	it("mounts without throwing", () => {
		const wrapper = mountInDwc(DuetTmcTuner);
		expect(wrapper.exists()).toBe(true);
	});

	it("computes and shows M569.2 register writes for the default motor", async () => {
		const wrapper = mountInDwc(DuetTmcTuner);
		await wrapper.vm.$nextTick();
		await wrapper.vm.$nextTick();
		// A motor is auto-selected on mount, so the computed register table + commands render.
		expect(wrapper.text()).toContain("Computed registers");
		expect(wrapper.text()).toContain("M569.2");
	});
});
