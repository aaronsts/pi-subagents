# pi-subagents v1 design

## Goal

Provide explicit, foreground delegation from Pi to three advisory roles: `scout`, `reviewer`, and `oracle`. One request can launch one to three roles in parallel.

## Boundary

- The package is project-local through a Pi package declaration, but lives in this standalone repository.
- The parent may invoke `subagent` only for an explicit current-user delegation request.
- Children are fresh `pi` subprocesses with no session persistence, no parent transcript, no ambient extensions, skills, prompt templates, or builtin tools.
- Children inherit the target repository working directory, so Pi applies its project instructions.
- Children get only four package-provided, repository-bound tools: `project_read`, `project_find`, `project_grep`, and `project_ls`.
- The wrappers reject paths outside the repository and deny `.env*`, `.git`, `node_modules`, `.pi`, key/certificate files, and credential/secret-named paths.
- There is no nested delegation, background execution, external CLI runner, network/upload feature, custom artifact store, or retry.

## Request and execution

`subagent` accepts a required `task`, one to three unique `roles`, and optional `paths` and `diff`. Each role receives the same bounded request context and a role-specific output contract. Roles execute concurrently, share the parent cancellation signal, and time out after ten minutes.

The configured child model is exact and required: `openai-codex/gpt-6-luna` with `medium` thinking. A missing or disabled configuration fails before any child starts. Each child output is capped at 1,500 words; failures return beside successful sibling results.

## Configuration

A target project opts in with `.pi/local-subagents.json`:

```json
{
  "enabled": true,
  "childModel": "openai-codex/gpt-6-luna"
}
```

The parent project's `.pi/settings.json` declares this repository as a local Pi package. The package itself has no dependencies beyond Pi's supplied extension API and TypeBox.

## Verification

Unit tests cover path normalization and deny rules. Manual smoke testing is opt-in because it makes paid model calls: run Pi with the package enabled and explicitly request one read-only role.
