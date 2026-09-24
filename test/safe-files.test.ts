import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { listSafeEntries, resolveSafePath } from "../src/safe-files.ts";

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-test-"));
	fs.mkdirSync(path.join(root, "src"));
	fs.mkdirSync(path.join(root, ".git"));
	fs.mkdirSync(path.join(root, "node_modules"));
	fs.writeFileSync(path.join(root, "src", "app.ts"), "export {};\n");
	fs.writeFileSync(path.join(root, ".env"), "TOKEN=nope\n");
	return root;
}

test("resolves ordinary project files", (t) => {
	const root = fixture();
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	assert.equal(resolveSafePath(root, "src/app.ts"), fs.realpathSync(path.join(root, "src", "app.ts")));
});

test("rejects traversal and sensitive paths", (t) => {
	const root = fixture();
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	assert.throws(() => resolveSafePath(root, "../outside.txt"));
	assert.throws(() => resolveSafePath(root, ".env"));
	assert.throws(() => resolveSafePath(root, ".git/config"));
	assert.throws(() => resolveSafePath(root, "node_modules/pkg/index.js"));
});

test("does not list denied entries", (t) => {
	const root = fixture();
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	assert.deepEqual(listSafeEntries(root), ["src/"]);
});

test("rejects symlinks to excluded files and directories inside the project", { skip: process.platform === "win32" }, (t) => {
	const root = fixture();
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.writeFileSync(path.join(root, "node_modules", "pkg.txt"), "fixture\n");
	fs.symlinkSync(path.join(root, "node_modules", "pkg.txt"), path.join(root, "src", "alias.txt"));
	fs.symlinkSync(path.join(root, "node_modules"), path.join(root, "src", "alias-dir"));
	assert.throws(() => resolveSafePath(root, "src/alias.txt"));
	assert.throws(() => resolveSafePath(root, "src/alias-dir/pkg.txt"));
	assert.throws(() => resolveSafePath(root, "src/alias-dir/new.txt"));
});

test("rejects symlinks that escape the project", { skip: process.platform === "win32" }, (t) => {
	const root = fixture();
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-outside-"));
	t.after(() => {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	});
	fs.writeFileSync(path.join(outside, "secret.txt"), "nope\n");
	fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "src", "escaped.txt"));
	assert.throws(() => resolveSafePath(root, "src/escaped.txt"));
});
