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
