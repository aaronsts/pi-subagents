import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { expandRoles, isRoleName, ROLE_NAMES, type RoleName } from "./roles.ts";
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

export function resultText(results: ChildResult[]) {
	return results.map((result) => `## ${result.role}${result.angle ? ` / ${result.angle}` : ""} — ${result.status}\n\n${result.output}`).join("\n\n---\n\n");
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
		description: "Explicitly delegate a codebase scouting, review, or plan-challenge task to one to three read-only roles. Reviewer fans out into three parallel angles (correctness/security, regressions/tests, maintainability), so a request may launch up to five children. Use only when the current user explicitly requests delegation. Children use the configured model and cannot edit files or run shell commands.",
		parameters: Params,
		execute: async (_id, input, signal, _onUpdate, ctx) => {
			const config = loadConfig(ctx.cwd);
			if (!config.enabled) throw new Error(`Subagents are disabled. Set enabled: true in ${CONFIG_FILE}.`);
			if (!config.childModel) throw new Error(`Set childModel in ${CONFIG_FILE}; no model fallback is allowed.`);
			if (new Set(input.roles).size !== input.roles.length || !input.roles.every(isRoleName)) {
				throw new Error(`roles must contain unique values from: ${ROLE_NAMES.join(", ")}.`);
			}
			const extensionPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "child-tools.ts");
			const assignments = expandRoles(input.roles as RoleName[]);
			const results = await Promise.all(assignments.map(({ role, angle }) => runChild({ role, angle, task: input.task, paths: input.paths, diff: input.diff, cwd: ctx.cwd, model: config.childModel!, extensionPath, signal: signal ?? new AbortController().signal })));
			return {
				content: [{ type: "text", text: `${resultText(results)}\n\nSynthesize these labelled advisory results. For reviewer findings, independently check each candidate against available source or supplied diff evidence before reporting it, deduplicate overlapping findings, and retain distinct evidence or disagreement. Do not claim tests were run or a diff was inspected when they were not. Treat failed or incomplete review angles as coverage gaps, not clean passes. Distinguish evidence from recommendations.` }],
				details: { results },
			};
		},
	});
}
