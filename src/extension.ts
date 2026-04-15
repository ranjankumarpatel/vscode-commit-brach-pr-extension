import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

const COMMAND_ID = 'githubWebStyle.commitToNewBranchAndCreatePr';
const OPEN_PR_ACTION = 'Open PR';
const DEFAULT_BRANCH_CANDIDATES = ['main', 'master'];
const MAX_COMMAND_OUTPUT = 10 * 1024 * 1024;

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

interface CommandOptions {
  readonly cwd: string;
  readonly allowNonZeroExit?: boolean;
  readonly missingToolMessage?: string;
}

interface RepositoryContext {
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly repoPath: string;
  readonly repoName: string;
  readonly copilotCliCommand: CopilotCliCommand;
}

interface CheckoutRef {
  readonly label: string;
  readonly value: string;
  readonly branchName?: string;
}

interface CopilotCliCommand {
  readonly command: string;
  readonly argsPrefix: readonly string[];
  readonly label: string;
}

interface WorkflowState {
  readonly originalRef: CheckoutRef;
}

class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

const COPILOT_CLI_CANDIDATES: readonly CopilotCliCommand[] = [
  {
    command: 'copilot',
    argsPrefix: [],
    label: '`copilot`'
  },
  {
    command: 'gh',
    argsPrefix: ['copilot', '--'],
    label: '`gh copilot`'
  }
];

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(COMMAND_ID, async (scmContext?: unknown) => {
    await runCreatePullRequestWorkflow(scmContext);
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // Nothing to dispose beyond the registered command.
}

async function runCreatePullRequestWorkflow(scmContext?: unknown): Promise<void> {
  try {
    const workspaceFolder = await resolveWorkspaceFolder(scmContext);
    if (!workspaceFolder) {
      return;
    }

    const repositoryContext = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'GitHub Web Style: validating workspace',
        cancellable: false
      },
      async (progress) => validateRepositoryContext(workspaceFolder, progress)
    );

    const generatedCommitMessage = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'GitHub Web Style: generating commit message with Copilot',
        cancellable: false
      },
      async (progress) =>
        generateCommitMessageWithCopilot(
          repositoryContext.repoPath,
          repositoryContext.copilotCliCommand,
          progress
        )
    );

    const commitMessage = await promptForCommitMessage(repositoryContext.repoName, generatedCommitMessage);
    if (commitMessage === undefined) {
      return;
    }

    const branchName = await generateAutomaticBranchName(repositoryContext.repoPath);

    const pullRequestUrl = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'GitHub Web Style: creating branch, commit, and pull request',
        cancellable: false
      },
      async (progress) =>
        executeCreatePullRequestWorkflow(repositoryContext, commitMessage, branchName, progress)
    );

    await showSuccessMessage(pullRequestUrl);
  } catch (error) {
    const message =
      error instanceof UserFacingError
        ? error.message
        : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;

    await vscode.window.showErrorMessage(`GitHub Web Style failed. ${message}`);
  }
}

async function resolveWorkspaceFolder(scmContext?: unknown): Promise<vscode.WorkspaceFolder | undefined> {
  const contextFolder = tryGetWorkspaceFolderFromScmContext(scmContext);
  if (contextFolder) {
    return contextFolder;
  }

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    await vscode.window.showErrorMessage('Open a workspace folder before creating a pull request.');
    return undefined;
  }

  const activeDocumentUri = vscode.window.activeTextEditor?.document.uri;
  if (activeDocumentUri) {
    const activeFolder = vscode.workspace.getWorkspaceFolder(activeDocumentUri);
    if (activeFolder) {
      return activeFolder;
    }
  }

  if (folders.length === 1) {
    return folders[0];
  }

  const pickedFolder = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder
    })),
    {
      placeHolder: 'Select the workspace folder that contains the git repository'
    }
  );

  return pickedFolder?.folder;
}

function tryGetWorkspaceFolderFromScmContext(scmContext: unknown): vscode.WorkspaceFolder | undefined {
  if (!scmContext || typeof scmContext !== 'object') {
    return undefined;
  }

  const rootUri =
    'rootUri' in scmContext && scmContext.rootUri instanceof vscode.Uri
      ? scmContext.rootUri
      : undefined;

  if (!rootUri) {
    return undefined;
  }

  return vscode.workspace.getWorkspaceFolder(rootUri);
}

async function validateRepositoryContext(
  workspaceFolder: vscode.WorkspaceFolder,
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<RepositoryContext> {
  progress.report({ message: 'Checking Git CLI availability...', increment: 10 });
  await ensureCommandAvailable('git', ['--version'], workspaceFolder.uri.fsPath, 'Git is not installed or not available on PATH.');

  progress.report({ message: 'Checking GitHub CLI availability...', increment: 15 });
  await ensureCommandAvailable('gh', ['--version'], workspaceFolder.uri.fsPath, 'GitHub CLI (`gh`) is not installed or not available on PATH.');

  progress.report({ message: 'Resolving git repository...', increment: 20 });
  const repoPath = await resolveRepositoryRoot(workspaceFolder.uri.fsPath);

  progress.report({ message: 'Checking origin remote...', increment: 15 });
  await ensureOriginRemote(repoPath);

  progress.report({ message: 'Checking GitHub authentication...', increment: 15 });
  await ensureGhAuthenticated(repoPath);

  progress.report({ message: 'Checking Copilot CLI availability...', increment: 15 });
  const copilotCliCommand = await resolveCopilotCliCommand(repoPath);

  progress.report({ message: 'Inspecting uncommitted changes...', increment: 10 });
  await ensureWorkingTreeHasChanges(repoPath);

  progress.report({ message: 'Validation complete.', increment: 15 });

  return {
    workspaceFolder,
    repoPath,
    repoName: path.basename(repoPath),
    copilotCliCommand
  };
}

async function ensureCommandAvailable(
  command: string,
  args: string[],
  cwd: string,
  message: string
): Promise<void> {
  await runCommand(command, args, {
    cwd,
    missingToolMessage: message
  });
}

async function resolveRepositoryRoot(cwd: string): Promise<string> {
  const result = await runCommand('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    missingToolMessage: 'Git is not installed or not available on PATH.'
  }).catch(() => {
    throw new UserFacingError('The selected workspace folder is not inside a git repository.');
  });

  const repoPath = result.stdout.trim();
  if (!repoPath) {
    throw new UserFacingError('The selected workspace folder is not inside a git repository.');
  }

  return repoPath;
}

async function ensureOriginRemote(repoPath: string): Promise<void> {
  try {
    await runCommand('git', ['remote', 'get-url', 'origin'], { cwd: repoPath });
  } catch {
    throw new UserFacingError('This repository does not have an `origin` remote configured.');
  }
}

async function ensureGhAuthenticated(repoPath: string): Promise<void> {
  try {
    await runCommand('gh', ['auth', 'status'], {
      cwd: repoPath,
      missingToolMessage: 'GitHub CLI (`gh`) is not installed or not available on PATH.'
    });
  } catch {
    throw new UserFacingError('GitHub CLI is not authenticated. Run `gh auth login` and try again.');
  }
}

async function resolveCopilotCliCommand(repoPath: string): Promise<CopilotCliCommand> {
  for (const candidate of COPILOT_CLI_CANDIDATES) {
    try {
      await runCommand(candidate.command, [...candidate.argsPrefix, '--version'], {
        cwd: repoPath,
        missingToolMessage: `GitHub Copilot CLI (${candidate.label}) is not available on PATH.`
      });
      return candidate;
    } catch {
      // Try the next supported entry point before surfacing a user-facing error.
    }
  }

  throw new UserFacingError(
    'GitHub Copilot CLI is not available. Install or enable `copilot` or `gh copilot`, restart VS Code, and try again.'
  );
}

async function ensureWorkingTreeHasChanges(repoPath: string): Promise<void> {
  const result = await runCommand('git', ['status', '--porcelain'], { cwd: repoPath });
  if (!result.stdout.trim()) {
    throw new UserFacingError('There are no uncommitted changes to commit.');
  }
}

async function promptForCommitMessage(
  repoName: string,
  suggestedCommitMessage: string
): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: 'Commit Message',
    prompt: `Enter a commit message for ${repoName}`,
    placeHolder: 'Describe the changes you want to commit',
    value: suggestedCommitMessage,
    valueSelection: [0, suggestedCommitMessage.length],
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Commit message is required.';
      }

      return undefined;
    }
  });
}

async function generateCommitMessageWithCopilot(
  repoPath: string,
  copilotCliCommand: CopilotCliCommand,
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<string> {
  progress.report({ message: 'Asking Copilot to inspect repository changes...', increment: 100 });

  try {
    const result = await runCopilot(repoPath, copilotCliCommand, [
      '-p',
      createCopilotCommitPrompt(),
      '-s',
      '--no-ask-user',
      '--allow-all-tools'
    ]);

    const commitMessage = sanitizeCopilotCommitMessage(result.stdout);
    if (!commitMessage) {
      throw new UserFacingError('Copilot returned an empty commit message.');
    }

    return commitMessage;
  } catch (error) {
    if (error instanceof UserFacingError) {
      throw new UserFacingError(
        `Unable to generate a commit message with GitHub Copilot CLI. ${error.message}`
      );
    }

    throw error;
  }
}

function createCopilotCommitPrompt(): string {
  return [
    'Inspect the current repository changes with git commands before answering.',
    'Use `git status --short --untracked-files=all`, `git diff --no-ext-diff --submodule=diff -- .`, and `git diff --cached --no-ext-diff --submodule=diff -- .` as needed.',
    'Then write a concise Git commit message for the current uncommitted changes.',
    'Return only one commit subject line.',
    'Do not include quotes, bullets, markdown, or explanations.',
    'Keep it under 72 characters when practical.'
  ].join('\n');
}

function sanitizeCopilotCommitMessage(output: string): string {
  const firstMeaningfulLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => Boolean(line));

  if (!firstMeaningfulLine) {
    return '';
  }

  return firstMeaningfulLine.replace(/^["'`]+|["'`]+$/g, '').trim();
}

async function generateAutomaticBranchName(repoPath: string): Promise<string> {
  const timestamp = createBranchTimestamp();
  return ensureUniqueBranchName(repoPath, `patch-pr-${timestamp}`);
}

function createBranchTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

async function ensureUniqueBranchName(repoPath: string, preferredName: string): Promise<string> {
  const baseName = preferredName || 'change-set';
  if (!(await branchExists(repoPath, baseName))) {
    return baseName;
  }

  let suffix = 2;
  while (await branchExists(repoPath, `${baseName}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseName}-${suffix}`;
}

async function branchExists(repoPath: string, branchName: string): Promise<boolean> {
  const localRef = await runCommand(
    'git',
    ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`],
    {
      cwd: repoPath,
      allowNonZeroExit: true
    }
  );

  if (localRef.exitCode === 0) {
    return true;
  }

  const remoteRef = await runCommand(
    'git',
    ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branchName}`],
    {
      cwd: repoPath,
      allowNonZeroExit: true
    }
  );

  return remoteRef.exitCode === 0;
}

async function executeCreatePullRequestWorkflow(
  repositoryContext: RepositoryContext,
  commitMessage: string,
  branchName: string,
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<string> {
  const { repoPath } = repositoryContext;
  const originalRef = await resolveCurrentCheckoutRef(repoPath);
  const baseBranch = await resolvePullRequestBaseBranch(repoPath, originalRef);
  const workflowState: WorkflowState = {
    originalRef
  };

  try {
    progress.report({ message: 'Fetching origin...', increment: 10 });
    await runGit(repoPath, ['fetch', 'origin']);

    progress.report({ message: `Using ${baseBranch} as the pull request base...`, increment: 10 });

    progress.report({ message: 'Validating target branch name...', increment: 10 });
    if (await branchExists(repoPath, branchName)) {
      throw new UserFacingError(
        `The branch "${branchName}" already exists locally or on origin. Choose a different branch name and try again.`
      );
    }

    progress.report({ message: `Creating branch ${branchName} from ${originalRef.label}...`, increment: 15 });
    await runGit(repoPath, ['checkout', '-b', branchName]);

    progress.report({ message: 'Staging changes...', increment: 10 });
    await runGit(repoPath, ['add', '.']);

    progress.report({ message: 'Creating commit...', increment: 10 });
    await runGit(repoPath, ['commit', '-m', commitMessage]);

    progress.report({ message: 'Pushing branch to origin...', increment: 5 });
    await runGit(repoPath, ['push', '-u', 'origin', branchName]);

    progress.report({ message: 'Creating pull request with GitHub CLI...', increment: 5 });
    const createPrResult = await runGh(repoPath, [
      'pr',
      'create',
      '--base',
      baseBranch,
      '--head',
      branchName,
      '--fill'
    ]);

    const pullRequestUrl =
      extractPullRequestUrl(createPrResult.stdout) ||
      extractPullRequestUrl(createPrResult.stderr) ||
      (await fetchPullRequestUrl(repoPath, branchName));

    if (!pullRequestUrl) {
      throw new UserFacingError('The pull request was created, but the PR URL could not be determined.');
    }

    return pullRequestUrl;
  } catch (error) {
    const recoveryNote = await tryRestoreOriginalCheckout(repoPath, workflowState);
    const baseMessage =
      error instanceof UserFacingError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    if (recoveryNote) {
      throw new UserFacingError(`${baseMessage} ${recoveryNote}`);
    }

    throw error;
  }
}

async function resolveCurrentCheckoutRef(repoPath: string): Promise<CheckoutRef> {
  const branchResult = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branchName = branchResult.stdout.trim();
  if (branchName && branchName !== 'HEAD') {
    return { label: branchName, value: branchName, branchName };
  }

  const commitResult = await runGit(repoPath, ['rev-parse', 'HEAD']);
  const commitHash = commitResult.stdout.trim();
  return {
    label: commitHash.slice(0, 7),
    value: commitHash
  };
}

async function resolvePullRequestBaseBranch(repoPath: string, checkoutRef: CheckoutRef): Promise<string> {
  if (checkoutRef.branchName) {
    return checkoutRef.branchName;
  }

  return detectDefaultBranch(repoPath);
}

async function detectDefaultBranch(repoPath: string): Promise<string> {
  const symbolicRefResult = await runCommand(
    'git',
    ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
    {
      cwd: repoPath,
      allowNonZeroExit: true
    }
  );

  if (symbolicRefResult.exitCode === 0) {
    const symbolicRef = symbolicRefResult.stdout.trim();
    const [, branchName] = symbolicRef.split('origin/');
    if (branchName) {
      return branchName;
    }
  }

  for (const candidate of DEFAULT_BRANCH_CANDIDATES) {
    const result = await runCommand(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${candidate}`],
      {
        cwd: repoPath,
        allowNonZeroExit: true
      }
    );

    if (result.exitCode === 0) {
      return candidate;
    }
  }

  throw new UserFacingError(
    'Unable to detect the default branch from origin. Ensure `origin/HEAD`, `origin/main`, or `origin/master` exists.'
  );
}

async function tryRestoreOriginalCheckout(
  repoPath: string,
  workflowState: WorkflowState
): Promise<string | undefined> {
  const currentRef = await resolveCurrentCheckoutRef(repoPath).catch(() => undefined);
  if (!currentRef || currentRef.value === workflowState.originalRef.value) {
    return undefined;
  }

  try {
    await runGit(repoPath, ['checkout', workflowState.originalRef.value]);
    return `The repository was switched back to ${workflowState.originalRef.label}.`;
  } catch {
    return `The repository is still on the temporary branch. Switch back to ${workflowState.originalRef.label} after resolving the repository state.`;
  }
}

async function fetchPullRequestUrl(repoPath: string, branchName: string): Promise<string | undefined> {
  const result = await runGh(repoPath, ['pr', 'view', branchName, '--json', 'url']);
  const trimmed = result.stdout.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as { url?: string };
    return parsed.url;
  } catch {
    return extractPullRequestUrl(trimmed);
  }
}

function extractPullRequestUrl(output: string): string | undefined {
  const match = output.match(/https?:\/\/\S+/);
  return match?.[0];
}

async function showSuccessMessage(pullRequestUrl: string): Promise<void> {
  const selection = await vscode.window.showInformationMessage(
    `Pull request created successfully: ${pullRequestUrl}`,
    OPEN_PR_ACTION
  );

  if (selection === OPEN_PR_ACTION) {
    await vscode.env.openExternal(vscode.Uri.parse(pullRequestUrl));
  }
}

async function runGit(repoPath: string, args: string[]): Promise<CommandResult> {
  return runCommand('git', args, {
    cwd: repoPath,
    missingToolMessage: 'Git is not installed or not available on PATH.'
  });
}

async function runGh(repoPath: string, args: string[]): Promise<CommandResult> {
  return runCommand('gh', args, {
    cwd: repoPath,
    missingToolMessage: 'GitHub CLI (`gh`) is not installed or not available on PATH.'
  });
}

async function runCopilot(
  repoPath: string,
  copilotCliCommand: CopilotCliCommand,
  args: string[]
): Promise<CommandResult> {
  return runCommand(copilotCliCommand.command, [...copilotCliCommand.argsPrefix, ...args], {
    cwd: repoPath,
    missingToolMessage: `GitHub Copilot CLI (${copilotCliCommand.label}) is not available on PATH.`
  });
}

async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        windowsHide: true,
        maxBuffer: MAX_COMMAND_OUTPUT
      },
      (error, stdout, stderr) => {
        const normalizedStdout = stdout?.toString() ?? '';
        const normalizedStderr = stderr?.toString() ?? '';
        const errorCode = (error as NodeJS.ErrnoException | null)?.code;
        const exitCode = typeof errorCode === 'number' ? errorCode : null;

        if (!error) {
          resolve({
            stdout: normalizedStdout,
            stderr: normalizedStderr,
            exitCode: 0
          });
          return;
        }

        const execError = error as NodeJS.ErrnoException;
        if (execError.code === 'ENOENT') {
          reject(new UserFacingError(options.missingToolMessage ?? `${command} is not available on PATH.`));
          return;
        }

        if (options.allowNonZeroExit && typeof execError.code === 'number') {
          resolve({
            stdout: normalizedStdout,
            stderr: normalizedStderr,
            exitCode
          });
          return;
        }

        reject(
          new UserFacingError(
            formatCommandError(command, args, normalizedStderr, normalizedStdout, execError.message)
          )
        );
      }
    );
  });
}

function formatCommandError(
  command: string,
  args: string[],
  stderr: string,
  stdout: string,
  fallbackMessage: string
): string {
  const details = stderr.trim() || stdout.trim() || fallbackMessage;
  return `Command failed: ${command} ${args.join(' ')}. ${details}`;
}
