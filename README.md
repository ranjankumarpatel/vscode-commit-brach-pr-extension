# GitHub Web Style Commit PR

VS Code extension that recreates the GitHub Web flow:


`Create a new branch for this commit and start a pull request`

The extension works on the current project repository, generates a commit message with GitHub Copilot CLI by inspecting the repository changes, creates a new branch automatically, commits the changes, pushes the branch, and opens a pull request.

## Command

`GitHub Web Style: Commit to New Branch and Create PR`

The command is available from:

- Command Palette
- Source Control title bar

## Current Behavior

When you run the command in a git project with uncommitted changes, the extension:

1. Validates `git`, `gh`, GitHub auth, Copilot CLI, repo state, and local changes
2. Uses `copilot` or `gh copilot` to inspect the project changes and generate a commit message suggestion
3. Lets you review or edit that commit message
4. Creates a new branch automatically as `patch-pr-<timestamp>`
5. Commits the current uncommitted changes on that new branch
6. Pushes the branch to `origin`
7. Creates a pull request with `gh pr create --base <current-branch> --head <new-branch> --fill`
8. Shows the PR URL with an `Open PR` button

The branch is created from the current checked out branch or commit context, so it behaves like GitHub Web's "create a new branch for this commit" flow. When you are on a branch, that branch is also used as the pull request base. When you are in detached HEAD state, the extension falls back to the repository default branch for the PR base.

## Prerequisites

- `git` installed and available on `PATH`
- `gh` installed and available on `PATH`
- `gh auth login` already completed
- GitHub Copilot CLI available either as `copilot` or through `gh copilot`
- Opened workspace folder must be inside a git repository with an `origin` remote
- The repository must have uncommitted changes

## Run In Development

1. Run `npm install`
2. Run `npm run compile`
3. Press `F5` in VS Code to launch the Extension Development Host
4. In the new window, open any git project with uncommitted changes
5. Run `GitHub Web Style: Commit to New Branch and Create PR`

## Install As A VS Code Extension

The latest packaged VSIX in this repo is:

- `github-web-style-commit-pr-0.0.4.vsix`

To install it:

1. Open VS Code
2. Run `Extensions: Install from VSIX...`
3. Choose `github-web-style-commit-pr-0.0.4.vsix`
4. Reload VS Code if prompted

## Package A New VSIX

1. Run `npm install`
2. Run `npm run compile`
3. Run `npm run package:vsix`

This creates a versioned `.vsix` file in the repo root.

## Notes

- The extension uses the target repository as the working directory, so it tracks the changes of the project where you invoke the command.
- In multi-root workspaces, it tries to use the SCM repository context you clicked from.
- If multiple workspace folders are open and there is no SCM context, the extension asks you to pick the repository folder.
- If pull request creation fails after switching branches, the extension tries to switch back to your original branch or commit.
- If you want VS Code to recognize a new build as an upgrade, bump the version in `package.json` before packaging.
