# pi-subagents

A small private Pi package for explicit, parallel, read-only `scout`, `reviewer`, and `oracle` subagents.

## Install in a project

Add this local package to the target project's `.pi/settings.json`:

```json
{
  "packages": [
    { "source": "/Users/rnsts/code/personal/pi-subagents" }
  ]
}
```

Then create `.pi/local-subagents.json` in that project:

```json
{
  "enabled": true,
  "childModel": "openai-codex/gpt-6-luna"
}
```

Restart Pi or run `/reload` after changing either file. Project packages load only after the project is trusted.

## Use

Ask Pi explicitly, for example:

- `Use scout to map the authentication flow.`
- `Run reviewer and oracle in parallel on this plan.`

The parent calls `subagent` with a task, one to three fixed roles, and optional paths or diff. Selecting `reviewer` launches three independent read-only passes in parallel: correctness/security, regressions/tests, and maintainability. The parent checks and deduplicates their findings; three passes use three child model calls, or up to five when combined with scout and oracle. Include relevant decisions and constraints in the task when using `oracle`: children do not receive the parent conversation. Reviewers cannot fetch a Git diff or run tests, so supply the diff when a diff review is needed.

## Safety model

Children are fresh, ephemeral Pi processes. They receive project instructions but not parent conversation history, ambient extensions, skills, builtin tools, shell access, or write access. They can only use package-provided read/search/list tools inside the repository. The tools deny paths such as `.env*`, `.git`, `.pi`, `node_modules`, and common secret/key names, including symlinks to excluded paths. Reads are limited to 1 MiB per file; searches report skipped files and truncated results instead of silently treating them as complete.

See [DESIGN.md](DESIGN.md) for the full v1 boundary and verification plan.

## Test

```bash
pnpm test
pnpm typecheck
```

A real-child smoke test is intentionally manual because it uses the configured provider and may incur cost.
