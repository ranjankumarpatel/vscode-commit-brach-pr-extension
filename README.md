# GitHub Web Style Commit PR

VS Code extension that takes your current uncommitted changes, creates a new branch from the latest default branch, commits the changes, pushes the branch, and opens a pull request through `gh`.

## Command

`GitHub Web Style: Commit to New Branch and Create PR`

The command is available from:

- Command Palette
- Source Control title bar

## Prerequisites

- `git` installed and available on `PATH`
- `gh` installed and available on `PATH`
- `gh auth login` already completed
- Opened workspace folder must be inside a git repository with an `origin` remote

## Run locally

1. Run `npm install`
2. Run `npm run compile`
3. Press `F5` in VS Code to launch the Extension Development Host
4. Open a git repository with uncommitted changes
5. Run `GitHub Web Style: Commit to New Branch and Create PR`

## Notes

The extension temporarily stashes your uncommitted changes before switching to the default branch, then reapplies them onto the new branch. This makes the workflow reliable when the current branch differs from the default branch.
