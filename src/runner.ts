import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { RoleName } from "./roles.ts";
import { buildSystemPrompt, buildTaskMessage } from "./roles.ts";

const CHILD_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_WORDS = 1_500;
const MAX_EVENT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_OUTPUT_CHARS = 32_000;

export type ChildResult = { role: RoleName; status: "completed" | "failed" | "timed-out" | "cancelled"; output: string };

function piInvocation(args: string[]) {
	const script = process.argv[1];
	if (script && fs.existsSync(script)) return { command: process.execPath, args: [script, ...args] };
	return { command: "pi", args };
}

function finalAssistantText(line: string): string | undefined {
	try {
		const event = JSON.parse(line) as { type?: string; message?: { role?: string; content?: Array<{ type?: string; text?: string }> } };
		if (event.type !== "message_end" || event.message?.role !== "assistant") return undefined;
		return event.message.content?.find((part) => part.type === "text")?.text;
	} catch {
		return undefined;
	}
}

function capWords(text: string): string {
	const words = text.trim().split(/\s+/);
	const limited = words.length <= MAX_WORDS ? text.trim() : `${words.slice(0, MAX_WORDS).join(" ")}\n\n[Output truncated at ${MAX_WORDS} words.]`;
	return limited.length <= MAX_OUTPUT_CHARS ? limited : `${limited.slice(0, MAX_OUTPUT_CHARS)}\n\n[Output truncated at ${MAX_OUTPUT_CHARS} characters.]`;
}

async function systemPromptFile(role: RoleName) {
	const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagents-"));
	const file = path.join(directory, `${role}.md`);
	await fs.promises.writeFile(file, buildSystemPrompt(role), { encoding: "utf8", mode: 0o600 });
	return { directory, file };
}

export function buildChildArgs(promptFile: string, input: { task: string; paths?: string[]; diff?: string; extensionPath: string; model: string }): string[] {
	return [
		"--mode", "json", "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-builtin-tools",
		"--extension", input.extensionPath,
		"--model", input.model,
		"--thinking", "medium",
		"--append-system-prompt", promptFile,
		"-p", buildTaskMessage(input),
	];
}

export async function runChild(input: { role: RoleName; task: string; paths?: string[]; diff?: string; cwd: string; model: string; extensionPath: string; signal: AbortSignal }): Promise<ChildResult> {
	const prompt = await systemPromptFile(input.role);
	try {
		return await new Promise((resolve) => {
			const invocation = piInvocation(buildChildArgs(prompt.file, input));
			const child = spawn(invocation.command, invocation.args, { cwd: input.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
			let output = "";
			let stderr = "";
			let stopped: "timed-out" | "cancelled" | "overflow" | undefined;
			let spawnError: Error | undefined;
			let killTimer: NodeJS.Timeout | undefined;
			const stop = (reason: "timed-out" | "cancelled" | "overflow") => {
				if (stopped) return;
				stopped = reason;
				child.kill("SIGTERM");
				killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
				killTimer.unref();
			};
			const timeout = setTimeout(() => stop("timed-out"), CHILD_TIMEOUT_MS);
			const abort = () => stop("cancelled");
			if (input.signal.aborted) abort();
			else input.signal.addEventListener("abort", abort, { once: true });
			let buffer = "";
			const decoder = new StringDecoder("utf8");
			child.stdout.on("data", (chunk: Buffer) => {
				if (stopped) return;
				buffer += decoder.write(chunk);
				// Process one record at a time; never retain an unlimited partial JSON line.
				let newline: number;
				while ((newline = buffer.indexOf("\n")) !== -1) {
					if (Buffer.byteLength(buffer.slice(0, newline)) > MAX_EVENT_BYTES) { stop("overflow"); return; }
					output = finalAssistantText(buffer.slice(0, newline)) ?? output;
					buffer = buffer.slice(newline + 1);
				}
				if (Buffer.byteLength(buffer) > MAX_EVENT_BYTES) stop("overflow");
			});
			child.stderr.on("data", (chunk: Buffer) => {
				if (stopped) return;
				const remaining = MAX_STDERR_BYTES - Buffer.byteLength(stderr);
				stderr += chunk.subarray(0, Math.max(0, remaining)).toString();
				if (chunk.length > remaining) stop("overflow");
			});
			child.on("close", (code) => {
				clearTimeout(timeout);
				if (killTimer) clearTimeout(killTimer);
				input.signal.removeEventListener("abort", abort);
				if (!stopped) {
					buffer += decoder.end();
					if (buffer && Buffer.byteLength(buffer) <= MAX_EVENT_BYTES) output = finalAssistantText(buffer) ?? output;
				}
				if (stopped === "timed-out") resolve({ role: input.role, status: "timed-out", output: "Child exceeded the 10-minute deadline." });
				else if (stopped === "cancelled") resolve({ role: input.role, status: "cancelled", output: "Child was cancelled with the parent request." });
				else if (stopped === "overflow") resolve({ role: input.role, status: "failed", output: "Child output exceeded the size limit." });
				else if (spawnError) resolve({ role: input.role, status: "failed", output: spawnError.message });
				else if (code === 0) resolve({ role: input.role, status: "completed", output: capWords(output || "(no output)") });
				else resolve({ role: input.role, status: "failed", output: capWords(stderr.trim() || output || `Child exited with code ${code ?? "unknown"}.`) });
			});
			child.on("error", (error) => { spawnError = error; });
		});
	} finally {
		await fs.promises.rm(prompt.directory, { recursive: true, force: true });
	}
}
