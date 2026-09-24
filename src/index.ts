import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isRoleName, ROLE_NAMES, type RoleName } from "./roles.ts";
import { runChild, type ChildResult } from "./runner.ts";

const CONFIG_FILE = path.join(".pi", "local-subagents.json");
const MAX_PATHS = 20;
const MAX_DIFF_BYTES = 50 * 1024;

function loadConfig(cwd: string): { enabled: boolean; childModel?: string } {
	const file = path.join(cwd, CONFIG_FILE);
	try {
		const value = JSON.parse(fs.readFileSync(file, "utf8")) as { enabled?: unknown; childModel?: unknown };
		return { enabled: value.enabled === true, childModel: typeof value.childModel === "string" ? value.childModel : undefined };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { enabled: false };
		throw new Error(`Could not parse ${CONFIG_FILE}: ${(error as Error).message}`);
	}
}

function resultText(results: ChildResult[]) {
	return results.map((result) => `## ${result.role} — ${result.status}\n\n${result.output}`).join("\n\n---\n\n");
}

const Params = Type.Object({
	task: Type.String({ minLength: 1, maxLength: 20_000, description: "Explicit task for the advisory subagents." }),
	roles: Type.Array(Type.String(), { minItems: 1, maxItems: 3, description: "One to three unique roles: scout, reviewer, oracle." }),
	paths: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: MAX_PATHS, description: "Optional repository-relative paths to inspect." })),
	diff: Type.Optional(Type.String({ maxLength: MAX_DIFF_BYTES, description: "Optional bounded diff for review." })),
});

export default function registerSubagents(pi: ExtensionAPI) {
	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: "Explicitly delegate a codebase scouting, review, or plan-challenge task to one to three read-only child agents. Use only when the current user explicitly requests delegation. Children run in parallel, use openai-codex/gpt-6-luna, and cannot edit files or run shell commands.",
		parameters: Params,
		execute: async (_id, input, signal, _onUpdate, ctx) => {
			const config = loadConfig(ctx.cwd);
			if (!config.enabled) throw new Error(`Subagents are disabled. Set enabled: true in ${CONFIG_FILE}.`);
			if (!config.childModel) throw new Error(`Set childModel in ${CONFIG_FILE}; no model fallback is allowed.`);
			if (new Set(input.roles).size !== input.roles.length || !input.roles.every(isRoleName)) {
				throw new Error(`roles must contain unique values from: ${ROLE_NAMES.join(", ")}.`);
			}
			const extensionPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "child-tools.ts");
			const roles = input.roles as RoleName[];
			const results = await Promise.all(roles.map((role) => runChild({ role, task: input.task, paths: input.paths, diff: input.diff, cwd: ctx.cwd, model: config.childModel!, extensionPath, signal: signal ?? new AbortController().signal })));
			return {
				content: [{ type: "text", text: `${resultText(results)}\n\nSynthesize these labelled advisory results, preserve disagreement, and distinguish evidence from recommendations.` }],
				details: { results },
			};
		},
	});
}
