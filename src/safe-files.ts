import * as fs from "node:fs";
import * as path from "node:path";

const DENIED_NAMES = new Set([".git", ".pi", "node_modules"]);
const DENIED_FILE = /(^\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$|(?:credential|secret|password|token|id_rsa))/i;

function checkDeniedPath(relative: string): void {
	for (const segment of relative.split(path.sep)) {
		if (DENIED_NAMES.has(segment) || DENIED_FILE.test(segment)) {
			throw new Error("Path is excluded by the subagent file policy.");
		}
	}
}

export function resolveSafePath(root: string, requestedPath: string): string {
	if (!requestedPath.trim()) throw new Error("A path is required.");
	const resolvedRoot = fs.realpathSync(root);
	const candidate = path.resolve(resolvedRoot, requestedPath);
	const relative = path.relative(resolvedRoot, candidate);
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new Error("Path is outside the repository.");
	}

	checkDeniedPath(relative);

	if (fs.existsSync(candidate)) {
		const realCandidate = fs.realpathSync(candidate);
		const realRelative = path.relative(resolvedRoot, realCandidate);
		if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
			throw new Error("Path resolves outside the repository.");
		}
		checkDeniedPath(realRelative);
		return realCandidate;
	}

	let current = candidate;
	while (!fs.existsSync(current)) current = path.dirname(current);
	const realParent = fs.realpathSync(current);
	const parentRelative = path.relative(resolvedRoot, realParent);
	if (parentRelative === ".." || parentRelative.startsWith(`..${path.sep}`) || path.isAbsolute(parentRelative)) {
		throw new Error("Path resolves outside the repository.");
	}
	checkDeniedPath(parentRelative);
	return candidate;
}

export function listSafeEntries(root: string, requestedPath = "."): string[] {
	const target = resolveSafePath(root, requestedPath);
	return fs
		.readdirSync(target, { withFileTypes: true })
		.filter((entry) => !DENIED_NAMES.has(entry.name) && !DENIED_FILE.test(entry.name))
		.map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
		.sort();
}
