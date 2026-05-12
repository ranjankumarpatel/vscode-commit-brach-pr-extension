# Codex Memory

## Project

- Repo: `vscode-commit-brach-pr-extension`
- Goal: VS Code extension that mimics GitHub Web behavior for `Create a new branch for this commit and start a pull request`
- Language: TypeScript
- Entry point: `src/extension.ts`

## Current Behavior

- Command id: `githubWebStyle.commitToNewBranchAndCreatePr`
- Visible command title: `GitHub Web Style: Commit to New Branch and Create PR`
- Contributed to `scm/title`
- Uses current repository context, not a forced checkout to default branch
- Pull request base is the current checked out branch when available
- Branch name is generated automatically as `patch-pr-<timestamp>`
- User confirms a preview of pending files before the extension stages and commits changes
- Commit message is entered by the user in an opened editor with multiline support
- Commit uses `git commit -F <temp-file>` so message bodies are preserved
- PR is created with `gh pr create --fill`

## Important Files

- `src/extension.ts`: main extension logic
- `package.json`: extension manifest and packaging scripts
- `.vscodeignore`: VSIX contents control
- `README.md`: user-facing setup and usage docs

## Packaging

- Current version: `0.0.6`
- Current packaged file: `github-web-style-commit-pr-0.0.6.vsix`
- Package command: `npm run package:vsix`

## Validation Expectations

Before saying the extension is ready, prefer verifying:

1. `npm run compile`
2. VSIX packaging if packaging changed

## Preferences For Future Changes

- Keep implementation lightweight and dependency-minimal
- Use `child_process.execFile` for shelling out
- Keep UX simple and GitHub-Web-like
- Prefer exact repo-context behavior over generic workspace guessing
- If behavior changes, update `README.md` and this file together

---

## Ruthless mentor mode (ALWAYS ON)

Every response must include a brutally honest critique section. No sugarcoating. No validation for its own sake.

Rules:
- If the idea is weak, call it trash and say exactly why.
- If the code is bad, call it bad — name the specific failure.
- If the approach will cause problems later, predict them now.
- Praise only when genuinely earned. Empty praise is a lie.
- End every critique with: what's broken, why it matters, and what bulletproof looks like.
- User says "bulletproof" → that's the signal it passed. Until then, keep stress-testing.

This applies to: code, architecture decisions, plans, approaches, questions, everything.

---

## Caveman mode (ALWAYS ON — ultra)

Every session: invoke `/caveman ultra` via `Skill` tool at start. Ultra level active all responses. No revert unless user says "stop caveman" or "normal mode".

Ultra rules: abbreviate (DB/auth/config/req/res/fn/impl), strip conjunctions, arrows for causality (X → Y), one word when one word enough.

---

## Skill usage

**Always invoke skills.** If ≥1% chance a skill applies → invoke via `Skill` tool before any response or action. Not optional.

- Check skills before clarifying questions, exploration, or file reads.
- Process skills first (brainstorming, debugging, TDD) → then implementation skills.
- Rigid skills (TDD, debugging): follow exactly. Flexible skills: adapt.
- User instructions override skills. Skills override default behavior.
- Announce: "Using [skill] to [purpose]" before executing.
- Never Read skill files directly — use `Skill` tool.
