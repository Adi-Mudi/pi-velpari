/**
 * /velpari-configure-agents + /velpari-agents commands (L3 composition).
 *
 * Mirror of Senai's commands/configure-agents.ts, minus the suggestion
 * engine — Velpari defaults are the identity map, so per-role options are
 * Keep current / Choose different / Use default (no "Accept suggestion").
 *
 * /velpari-configure-agents: headless gate → discoverAgents + loadAgentConfig
 * → outer runRolePicker loop over all 38 VELPARI_ROLES (cursor restore via
 * initialSelectedId) → per-role runSimplePicker → Finish materializes the
 * full 38-role map and saves. Back cancels WITHOUT writing anything.
 *
 * /velpari-agents: read-only display twin — renders the effective
 * role → agent mapping and validates that mapped custom agents exist.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_AGENTS,
	ROLE_LABELS,
	VELPARI_ROLES,
	discoverAgents,
	loadAgentConfig,
	resolveAgentName,
	saveAgentConfig,
	validateMappedAgents,
	type AgentConfig,
	type VelpariRole,
} from "../core/agents-config.js";
import { runRolePicker, type RolePickerItem } from "../ui/role-picker.js";
import { runSimplePicker, type SimplePickerItem } from "../ui/simple-picker.js";

export function registerAgentCommands(pi: ExtensionAPI): void {
	pi.registerCommand("velpari-configure-agents", {
		description: "Interactively map Velpari's 38 scout roles to agents.",
		handler: async (_args, ctx) => {
			await handleConfigureAgents(ctx);
		},
	});

	pi.registerCommand("velpari-agents", {
		description: "Show the current role → agent mapping and validation status.",
		handler: async (_args, ctx) => {
			handleShowAgents(ctx);
		},
	});
}

async function handleConfigureAgents(ctx: ExtensionCommandContext): Promise<void> {
	if (ctx.hasUI === false) {
		ctx.ui.notify(
			"This command needs an interactive terminal (TUI). It does nothing in headless mode.",
			"warning",
		);
		return;
	}
	const cwd = ctx.cwd;
	const agents = discoverAgents(cwd);
	let existing: AgentConfig | null;
	try {
		existing = loadAgentConfig(cwd);
	} catch (err) {
		ctx.ui.notify(
			`${(err as Error).message} Fix or delete the file, then re-run /velpari-configure-agents.`,
			"error",
		);
		return;
	}
	const mapping: Partial<Record<VelpariRole, string>> = {};

	const effectiveAgent = (role: VelpariRole): string =>
		mapping[role] ?? resolveAgentName(existing, role);

	let lastSelectedId: string | undefined;
	let editing = true;
	while (editing) {
		const items: RolePickerItem[] = VELPARI_ROLES.map((role) => {
			const effective = effectiveAgent(role);
			const isCustom = effective !== DEFAULT_AGENTS[role];
			return {
				id: role,
				label: ROLE_LABELS[role],
				agent: effective,
				summary: isCustom ? "custom" : "default",
				assigned: isCustom,
			};
		});

		const action = await runRolePicker(ctx, {
			title: "Configure agents",
			subtitle: " Enter edits one role • Finish saves all • Back cancels. Unedited roles keep their current agent.",
			items,
			initialSelectedId: lastSelectedId,
			showBack: true,
		});

		if (action.kind === "back") {
			ctx.ui.notify("Agent configuration cancelled — no changes saved.", "info");
			return;
		}
		if (action.kind !== "role") {
			editing = false;
			break;
		}

		const role = action.role as VelpariRole;
		lastSelectedId = role;
		const current = effectiveAgent(role);

		const pickerItems: SimplePickerItem[] = [
			{ id: "keep", label: `Keep current: ${current}` },
			{ id: "choose", label: "Choose different" },
			{ id: "default", label: `Use default: ${DEFAULT_AGENTS[role]}` },
		];

		const choice = await runSimplePicker(ctx, {
			title: `Configure agent for ${ROLE_LABELS[role]} (${role})`,
			items: pickerItems,
		});

		if (choice === "keep") {
			mapping[role] = current;
		} else if (choice === "choose") {
			const agentItems: SimplePickerItem[] = agents.map((a) => ({
				id: a.name,
				label: `${a.name} (${a.source})`,
			}));
			const selected = await runSimplePicker(ctx, {
				title: `Select agent for ${ROLE_LABELS[role]} (${role})`,
				items: agentItems,
			});
			// Esc out of the second picker: no change.
			if (selected) mapping[role] = selected;
		} else if (choice === "default") {
			mapping[role] = DEFAULT_AGENTS[role];
		}
		// undefined (esc): no change, back to the role list.
	}

	// Materialize the full 38-role map so agents.json is self-contained.
	const finalMapping: Partial<Record<VelpariRole, string>> = {};
	for (const role of VELPARI_ROLES) {
		finalMapping[role] = effectiveAgent(role);
	}

	saveAgentConfig(cwd, { version: 1, agents: finalMapping });
	ctx.ui.notify("Agent configuration saved to .pi/velpari/agents.json", "info");
}

function handleShowAgents(ctx: ExtensionCommandContext): void {
	const cwd = ctx.cwd;
	let config: AgentConfig | null;
	try {
		config = loadAgentConfig(cwd);
	} catch (err) {
		ctx.ui.notify((err as Error).message, "error");
		return;
	}
	if (!config) {
		ctx.ui.notify(
			"No agents.json — all 38 roles use bundled defaults. Run /velpari-configure-agents to customize.",
			"info",
		);
		return;
	}

	const lines = ["Velpari Agent Registry", ""];
	for (const role of VELPARI_ROLES) {
		lines.push(`  ${ROLE_LABELS[role]} (${role}) → ${resolveAgentName(config, role)}`);
	}

	const errors = validateMappedAgents(cwd, config);
	if (errors.length > 0) {
		lines.push("", "Errors:", ...errors.map((e) => `  ❌ ${e}`));
		ctx.ui.notify(lines.join("\n"), "error");
	} else {
		lines.push("", "All mapped agents are available.");
		ctx.ui.notify(lines.join("\n"), "info");
	}
}
