import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleDoctor } from "../doctor/index.js";

export function registerDoctorCommand(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-doctor", {
		description: "Real handler for /velpari-doctor (Phase 7).",
		handler: async (_args, ctx) => {
			await handleDoctor(ctx as never, pi as never);
		},
	});
}
