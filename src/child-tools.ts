import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { listSafeEntries, resolveSafePath } from "./safe-files.ts";

const MAX_READ_LINES = 500;
const MAX_RESULTS = 100;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_LINE_CHARS = 4_000;

function text(value: string) {
	return { content: [{ type: "text" as const, text: value }], details: undefined };
}

// Read at most one byte past the limit, even if the file grows between checks.
function readBounded(file: string): string {
	if (!fs.statSync(file).isFile()) throw new Error("Path is not a file.");
	const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
	try {
		if (!fs.fstatSync(fd).isFile()) throw new Error("Path is not a file.");
		const chunks: Buffer[] = [];
		let size = 0;
		while (size <= MAX_FILE_BYTES) {
			const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_FILE_BYTES + 1 - size));
			const count = fs.readSync(fd, chunk, 0, chunk.length, null);
			if (count === 0) break;
			chunks.push(chunk.subarray(0, count));
			size += count;
		}
		if (size > MAX_FILE_BYTES) throw new Error(`File exceeds the ${MAX_FILE_BYTES}-byte read limit.`);
		return Buffer.concat(chunks).toString("utf8");
	} finally {
		fs.closeSync(fd);
	}
}

function shortLine(line: string): string {
	return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}… [line truncated]` : line;
}

// Returning false stops traversal; callers must disclose that results are incomplete.
function walk(root: string, directory: string, visit: (relative: string) => boolean): boolean {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const relative = path.relative(root, path.join(directory, entry.name));
		let safe: string;
		try {
			safe = resolveSafePath(root, relative);
		} catch {
			continue;
		}
		if (entry.isDirectory()) {
			if (!walk(root, safe, visit)) return false;
		} else if (entry.isFile() && !visit(relative)) {
			return false;
		}
	}
	return true;
}

export default function registerChildTools(pi: ExtensionAPI) {
	const root = process.cwd();

	pi.registerTool({
		name: "project_read",
		label: "Project Read",
		description: "Read a UTF-8 text file inside the safe project boundary (maximum 1 MiB).",
		parameters: Type.Object({ path: Type.String(), offset: Type.Optional(Type.Integer({ minimum: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_READ_LINES })) }),
		execute: async (_id, input) => {
			const file = resolveSafePath(root, input.path);
			const lines = readBounded(file).split("\n");
			const offset = (input.offset ?? 1) - 1;
			const selected = lines.slice(offset, offset + (input.limit ?? MAX_READ_LINES));
			return text(selected.map((line, index) => `${offset + index + 1}: ${shortLine(line)}`).join("\n"));
		},
	});

	pi.registerTool({
		name: "project_ls",
		label: "Project List",
		description: "List safe files and directories inside the project.",
		parameters: Type.Object({ path: Type.Optional(Type.String()) }),
		execute: async (_id, input) => text(listSafeEntries(root, input.path ?? ".").join("\n")),
	});

	pi.registerTool({
		name: "project_find",
		label: "Project Find",
		description: "Find safe project files whose relative paths include a case-insensitive query.",
		parameters: Type.Object({ query: Type.String({ minLength: 1 }) }),
		execute: async (_id, input) => {
			const matches: string[] = [];
			const complete = walk(root, root, (file) => {
				if (file.toLowerCase().includes(input.query.toLowerCase())) matches.push(file);
				return matches.length <= MAX_RESULTS;
			});
			return text(`${matches.slice(0, MAX_RESULTS).join("\n")}${complete ? "" : "\n[Results truncated; search incomplete.]"}`.trim());
		},
	});

	pi.registerTool({
		name: "project_grep",
		label: "Project Grep",
		description: "Search safe UTF-8 project files for literal text (files over 1 MiB are skipped and reported).",
		parameters: Type.Object({ query: Type.String({ minLength: 1 }) }),
		execute: async (_id, input) => {
			const matches: string[] = [];
			let skipped = 0;
			const complete = walk(root, root, (relative) => {
				let lines: string[];
				try {
					lines = readBounded(resolveSafePath(root, relative)).split("\n");
				} catch {
					skipped++;
					return true;
				}
				for (const [index, line] of lines.entries()) {
					if (line.includes(input.query)) matches.push(`${relative}:${index + 1}: ${shortLine(line)}`);
					if (matches.length > MAX_RESULTS) return false;
				}
				return true;
			});
			const notices = [
				!complete ? "[Results truncated; search incomplete.]" : "",
				skipped ? `[${skipped} unreadable or oversized file(s) skipped; search incomplete.]` : "",
			].filter(Boolean);
			return text([...matches.slice(0, MAX_RESULTS), ...notices].join("\n"));
		},
	});
}
