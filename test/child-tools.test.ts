import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerChildTools from "../src/child-tools.ts";

type Tool = { execute: (id: string, input: never) => Promise<{ content: Array<{ text: string }> }> };

function toolsIn(root: string): Map<string, Tool> {
	const tools = new Map<string, Tool>();
	const previous = process.cwd();
	try {
		process.chdir(root);
		registerChildTools({ registerTool: (tool: Tool & { name: string }) => { tools.set(tool.name, tool); } } as unknown as ExtensionAPI);
	} finally {
		process.chdir(previous);
	}
	return tools;
}

test("find and grep search beyond the first 100 files", async (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-search-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	for (let i = 0; i < 105; i++) fs.writeFileSync(path.join(root, `file-${String(i).padStart(3, "0")}.txt`), i === 104 ? "unique-needle\n" : "ordinary\n");
	const tools = toolsIn(root);
	const found = await tools.get("project_find")!.execute("id", { query: "file-104" } as never);
	const grepped = await tools.get("project_grep")!.execute("id", { query: "unique-needle" } as never);
	assert.match(found.content[0].text, /file-104\.txt/);
	assert.match(grepped.content[0].text, /file-104\.txt:1: unique-needle/);
});

test("grep reports oversized files and find reports truncated results", async (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-search-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	for (let i = 0; i < 101; i++) fs.writeFileSync(path.join(root, `match-${String(i).padStart(3, "0")}.txt`), "ordinary\n");
	fs.writeFileSync(path.join(root, "oversized.txt"), "x".repeat(1024 * 1024 + 1));
	const tools = toolsIn(root);
	const found = await tools.get("project_find")!.execute("id", { query: "match" } as never);
	const grepped = await tools.get("project_grep")!.execute("id", { query: "not-present" } as never);
	assert.match(found.content[0].text, /Results truncated; search incomplete/);
	assert.match(grepped.content[0].text, /oversized file\(s\) skipped; search incomplete/);
	await assert.rejects(tools.get("project_read")!.execute("id", { path: "oversized.txt" } as never), /read limit/);
});
