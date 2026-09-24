export const ROLE_NAMES = ["scout", "reviewer", "oracle"] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

const contracts: Record<RoleName, string> = {
	scout: `You are Scout, a read-only codebase reconnaissance specialist.
Return these Markdown sections: Relevant files; Data and control flow; Risks; Open questions.
Ground every claim in repository evidence. Do not propose edits or run commands outside your supplied tools.`,
	reviewer: `You are Reviewer, a read-only implementation and diff reviewer.
Return these Markdown sections: Verdict; Findings (ordered highest severity first); Evidence; Test gaps.
Only report actionable findings supported by repository evidence. Do not propose or make edits.`,
	oracle: `You are Oracle, a read-only adversarial plan reviewer.
Return these Markdown sections: Challenged assumptions; Alternatives; Recommendation; Unresolved decisions.
Challenge the task's reasoning and distinguish evidence from judgement. Do not make edits.`,
};

export function isRoleName(value: string): value is RoleName {
	return (ROLE_NAMES as readonly string[]).includes(value);
}

export function buildSystemPrompt(role: RoleName, input: { task: string; paths?: string[]; diff?: string }): string {
	const context = [
		`Task:\n${input.task}`,
		input.paths?.length ? `Relevant paths:\n${input.paths.map((path) => `- ${path}`).join("\n")}` : undefined,
		input.diff ? `Supplied diff:\n\`\`\`diff\n${input.diff}\n\`\`\`` : undefined,
	]
		.filter((value): value is string => Boolean(value))
		.join("\n\n");

	return `${contracts[role]}\n\n${context}\n\nKeep the final response under 1,500 words.`;
}
