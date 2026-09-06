# Git Install Guide for Pi Extensions

A practical, reproducible guide to install any Pi extension via the `git:` URL path, with branch protection on GitHub and a local pre-push hook. Works for solo developers and teams.

## What this guide is for

You maintain a Pi extension locally and want to:

- Share a frozen version of it with other users (or your future self across machines)
- Prevent accidental direct pushes to `main` on GitHub
- Get a friendly local warning before a push gets rejected by GitHub

This guide covers all three. It is the same procedure that was used to set up `pi-velpari`, captured for reuse.

## Prerequisites

- GitHub account
- A working Pi installation (the `pi` command is available)
- Node.js 20 or newer (for building TypeScript extensions)
- A local git repo of the extension source code
- Terminal access with the ability to type commands and paste a PAT

## Step 0 — Pick your install path

Pi supports 5 ways to install an extension. Pick based on your goal:

| Path | Source | Live edit? | Needs publish? | Use when |
|---|---|---|---|---|
| Single file at `~/.pi/agent/extensions/*.ts` | local | yes | no | tiny one-file tools |
| Symlink at `~/.pi/agent/extensions/<name>/` | local | yes | no | active development |
| `npm:<pkg>@<ver>` in settings.json | npm registry | no | yes (`npm publish`) | public release |
| `git:<url>` in settings.json | git repo | no | no (just git push) | **frozen version sharing — recommended** |
| `extensions: ["abs/path.js"]` in settings.json | absolute file path | yes | no | quick test of one file |

**This guide covers `git:`** — the recommended path for any extension that will be shared or maintained long-term.

## Step 1 — Repository setup

### 1.1 Create a public GitHub repo

1. Open https://github.com/new
2. Choose a name (example: `pi-myextension`)
3. Visibility: **Public**. Private repos require a token configured for `git:` to clone.
4. Do **NOT** initialize with README, .gitignore, or license (you have these locally)
5. Click **Create**

### 1.2 Update package.json for git: install

The `git:` install runs `npm install` in the cloned repo, then loads the entry from `package.json`. Two choices:

- **Built extension** (TypeScript compiled to JavaScript): commit `dist/` to git, point entry at the built JS.
- **Source-only extension**: skip the build, point entry at the source `*.ts` file. Pi has a built-in TypeScript loader.

The second option is simpler. In `package.json`:

```json
{
  "name": "pi-myextension",
  "version": "1.0.0",
  "type": "module",
  "main": "./pi-extension/src/index.ts",
  "pi": {
    "extensions": ["./pi-extension/src/index.ts"]
  }
}
```

Commit:

```bash
git add package.json
git commit -m "point entry at TS source for git: install"
```

If you choose the built-JS path instead, add `dist/` to git (remove it from `.gitignore`) and replace `index.ts` with the path to your built entry.

### 1.3 First push (with PAT)

Generate a GitHub Personal Access Token at https://github.com/settings/tokens:

- Click **Generate new token** → **classic**
- Note: `<your-extension> push YYYY-MM-DD`
- Expiration: **7 days** (one-time use is fine)
- Scopes: check ONLY **`repo`** (full control of repositories)

Copy the token. You will paste it into a one-shot push command. Do not save it.

Push:

```bash
git remote add origin https://github.com/<YourUser>/pi-myextension.git

# One-shot push with PAT inline
git push https://x-access-token:<PAT>@github.com/<YourUser>/pi-myextension.git main

# Reset remote URL to clean form (no PAT stored)
git remote set-url origin https://github.com/<YourUser>/pi-myextension.git
```

If your repo contains files under `.github/workflows/`, see Bug 1 below — you may need to delete those files first.

## Step 2 — Pi installation

### 2.1 Add git: entry to settings.json

Edit `/home/<user>/.pi/agent/settings.json` and add to the `packages` array:

```json
"git:github.com/<YourUser>/pi-myextension"
```

Example with existing packages:

```json
"packages": [
  "npm:pi-intercom",
  "git:github.com/<YourUser>/pi-myextension"
]
```

Validate the JSON after editing:

```bash
node -e "JSON.parse(require('fs').readFileSync('/home/<user>/.pi/agent/settings.json','utf8'))"
```

### 2.2 Restart Pi

Quit Pi completely and reopen it. Pi will:

1. See the new `git:` entry in settings.json
2. Clone the repo to `~/.pi/agent/git/github.com/<YourUser>/pi-myextension/`
3. Run `npm install` (see Bug 6 — this may be incomplete)
4. Load the extension via its built-in TS loader

### 2.3 Verify

In Pi, type `/v`. Your commands should appear with the prefix `[u:git:github.com/<YourUser>/pi-myextension]`.

If the prefix is just `[u]` (without the URL), a symlink install is also active. Remove it:

```bash
rm ~/.pi/agent/extensions/<name>
```

Then restart Pi.

### 2.4 If Pi fails to load the extension

Open the Pi startup log. Look for one of:

- `Failed to load extension "...index.ts"` — see Bug 7 (symlink + clone conflict) or Bug 6 (empty node_modules)
- `Unknown file extension ".ts"` — Pi is loading the source TS directly but the TS loader is not active. Check `core.hooksPath` and the symlink target.

## Step 3 — Branch protection (two layers)

Branch protection has two layers. Set both — they catch the mistake at different stages.

### 3.1 Server layer (GitHub)

1. Open `https://github.com/<YourUser>/pi-myextension/settings/branches`
2. Click **Add rule** (or **Add classic branch protection rule**)
3. Branch name pattern: **`main`**
4. Check:
   - ☑ **Require a pull request before merging**
   - ☑ **Allow squash merging** (keeps history clean)
5. If you are solo: leave **Require approvals** unchecked (you cannot approve your own PR). See Step 4 for the code-owner alternative.
6. ☑ **Do not allow bypassing the above settings**
7. Leave everything else unchecked
8. Click **Create**

### 3.2 Local layer (pre-push hook)

A global hook blocks direct pushes to `main` or `master` on any repo. Friendly error message, no auth needed to trigger.

```bash
mkdir -p ~/.git-hooks
cat > ~/.git-hooks/pre-push << 'HOOK'
#!/bin/sh
# Pre-push hook: block direct pushes to protected branches (main, master).
# Applies to every repo via `git config --global core.hooksPath ~/.git-hooks`.
#
# To bypass (not recommended): git push --no-verify

protected_branches="main master"

while read local_ref local_sha remote_ref remote_sha; do
    case "$remote_ref" in
        refs/heads/*)
            branch="${remote_ref#refs/heads/}"
            for protected in $protected_branches; do
                if [ "$branch" = "$protected" ]; then
                    echo ""
                    echo "  BLOCKED: direct push to '$branch' is not allowed."
                    echo "  Create a feature branch, then open a Pull Request on GitHub."
                    echo "  To bypass (not recommended): git push --no-verify"
                    echo ""
                    exit 1
                fi
            done
            ;;
    esac
done

exit 0
HOOK
chmod +x ~/.git-hooks/pre-push
git config --global core.hooksPath ~/.git-hooks
```

**Important:** the file MUST be named exactly `pre-push` (not `global-pre-push` or `myhook`). Git looks for files by hook name. See Bug 3.

### 3.3 Verify both layers

```bash
# Test 1: local hook blocks (no network call needed)
git push origin main
# Expected: "BLOCKED: direct push to 'main' is not allowed."

# Test 2: local hook bypass, GitHub rejects
git push --no-verify https://x-access-token:<PAT>@github.com/<YourUser>/pi-myextension.git main
# Expected: "remote: error: GH006: Protected branch update failed"

# Test 3: feature branch push succeeds
git checkout -b test/protection-check
echo "" >> README.md
git commit -am "test: verify protection"
git push origin test/protection-check
# Expected: succeeds, GitHub offers "Create pull request" link

# Test 4 (browser): open the PR, merge it on GitHub
# Expected: green merge button, no approval gate (because we disabled Require approvals)
```

If Test 1 does not show `BLOCKED`, see Bug 3 (wrong filename), Bug 4 (stdin consumed), or Bug 9 (hook not invoked).

## Step 4 — Optional CODEOWNERS

For a stricter review gate that still allows self-merge:

1. Create `.github/CODEOWNERS` in your repo:
   ```
   * @<YourGitHubUsername>
   ```
2. Commit and push to main (via PR workflow as usual).
3. Edit the branch protection rule on `main` and check ☑ **Require review from Code Owners**.
4. Done. You ARE the code owner, so you can approve your own PRs. Self-merge still works.

Future collaborators: when they push a branch, GitHub auto-requests `Adi-Mudi` (or whoever is in CODEOWNERS) as a reviewer. The PR cannot merge until you approve.

To enable "Require review from Code Owners" via the GitHub API:

```bash
curl -X PATCH \
  -H "Authorization: Bearer <PAT>" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/<YourUser>/pi-myextension/branches/main/protection/required_pull_request_reviews \
  -d '{
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 0
  }'
```

Note: it is PATCH, not PUT. PUT returns 404 on this sub-resource.

## Step 5 — Daily workflow

```bash
# 1. Start a feature branch
cd /path/to/pi-myextension
git checkout -b feat/something
# edit files...

# 2. Commit and push
git add -A
git commit -m "feat: something"
git push origin feat/something

# 3. Open PR in browser, merge on GitHub
#    (https://github.com/<YourUser>/pi-myextension/compare/main...feat/something)

# 4. Sync everywhere
cd /path/to/pi-myextension
git checkout main
git pull origin main
cd ~/.pi/agent/git/github.com/<YourUser>/pi-myextension
git pull origin main

# 5. Reload Pi
# /reload
```

## Troubleshooting — 9 known failures

### Bug 1 — Push rejected: `workflow` scope missing

Symptom: `refusing to allow a Personal Access Token to create or update workflow .github/workflows/...yml without workflow scope`

Cause: GitHub requires the `workflow` scope to push files under `.github/workflows/`. Most extension repos do not actually need those files.

Fix (pick one):
- Delete workflow files from your repo before pushing:
  ```bash
  git rm .github/workflows/*.yml
  git commit -m "ci: remove GitHub Actions workflows"
  git push
  ```
- Or create a new PAT with both `repo` AND `workflow` scopes.

### Bug 2 — Stale `.git/index.lock`

Symptom: `fatal: Unable to create '.git/index.lock': File exists`

Cause: A previous `git` command crashed without cleaning up its lock.

Fix: First confirm no real `git` process is running:
```bash
ps aux | grep "git " | grep -v grep
```
If only the bash tool runs are visible (and no real git push is pending), remove the lock:
```bash
rm .git/index.lock
```

### Bug 3 — Pre-push hook not running (file name wrong)

Symptom: `git push origin main` proceeds past the auth prompt without any `BLOCKED` message.

Cause: The hook file is named something other than `pre-push`. Git looks for files in `core.hooksPath` with exact hook names (`pre-commit`, `pre-push`, `commit-msg`, etc.).

Fix: Rename it:
```bash
mv ~/.git-hooks/global-pre-push ~/.git-hooks/pre-push
```

### Bug 4 — Hook exits immediately with no output

Symptom: Hook returns exit 0 instead of exit 1. No `BLOCKED` message printed.

Cause: The hook consumed stdin via `cat > /tmp/logfile` BEFORE the `while read` loop. So `read` got an empty stream, the loop body never ran, and execution fell through to `exit 0`.

Fix: Do NOT use `cat` at the top of the hook to log stdin. If you need debug output, write it INSIDE the while loop AFTER the read:
```bash
while read local_ref local_sha remote_ref remote_sha; do
    echo "debug: $local_ref -> $remote_ref" > /tmp/logfile
    case "$remote_ref" in
        ...
    esac
done
```

### Bug 5 — Git auth fails in non-interactive shell

Symptom: `fatal: could not read Username for 'https://github.com'` or `fatal: could not read Password`

Cause: The Bash tool (and CI environments) have terminal prompts disabled. git cannot ask for credentials.

Fix (pick one):
- Use `https://x-access-token:<PAT>@github.com/...` URL format with `x-access-token` as the username.
- Use a `GIT_ASKPASS` script that returns the credentials:
  ```bash
  cat > /tmp/git-askpass << 'EOF'
  #!/bin/sh
  echo "username=x-access-token"
  echo "password=<PAT>"
  EOF
  chmod +x /tmp/git-askpass
  GIT_ASKPASS=/tmp/git-askpass GIT_TERMINAL_PROMPT=0 git push origin main
  ```
- Run the test in your own interactive terminal.

### Bug 6 — Pi's `git:` install leaves `node_modules` empty

Symptom: After Pi clones the repo, `ls ~/.pi/agent/git/<host>/<user>/<repo>/node_modules/` shows empty subdirectories. Extension fails to load due to missing peer deps. Pi reports "up to date, audited 1 package" right after cloning.

Cause: Pi runs `npm install` after cloning but only creates the directory skeleton. Known Pi-specific behavior, not documented anywhere obvious.

Fix: Run `npm install` manually inside the clone:
```bash
cd ~/.pi/agent/git/github.com/<YourUser>/pi-myextension
npm install
```

Now Pi loads the extension correctly.

### Bug 7 — Extension fails to load: flag conflicts

Symptom: `Error: Failed to load extension ".../index.ts": Flag "--myflag" conflicts with .../index.js`

Cause: You have both a symlink install AND a `git:` install active for the same extension. Both try to register the same flag names.

Fix: Remove the old symlink path:
```bash
rm ~/.pi/agent/extensions/<name>
```
Restart Pi.

### Bug 8 — Cannot merge own PR

Symptom: PR shows "Waiting for review" forever.

Cause: Branch protection has `Require approvals: 1` enabled, and you cannot approve your own PR.

Fix (pick one):
- For solo work: disable `Require approvals`. External PRs can be merged without review, but you can still manually review before merging.
- For real review gate that allows self-merge: use CODEOWNERS + `Require review from Code Owners`. You ARE the code owner, so self-approval works.

### Bug 9 — Hook installed but git ignores it

Symptom: `core.hooksPath` is set but push proceeds without hook running.

Cause: Hook file is not executable, OR `core.hooksPath` was overridden per-repo, OR `git push` never reaches the hook stage.

Fix checklist:
```bash
# 1. File exists with correct name
ls ~/.git-hooks/pre-push

# 2. File is executable
test -x ~/.git-hooks/pre-push && echo OK || chmod +x ~/.git-hooks/pre-push

# 3. Global hooks path is set
git config --global core.hooksPath
# Expected: /home/<user>/.git-hooks (or wherever you put it)

# 4. No local override
git config --local core.hooksPath
# Expected: empty

# 5. Hook logic works in isolation
printf "refs/heads/feat/x abc refs/heads/main 000\n" | ~/.git-hooks/pre-push
echo "exit: $?"
# Expected: BLOCKED message, exit 1
```

## Rollback

If anything goes wrong, undo in reverse order:

1. **Branch protection (GitHub):** open repo Settings → Branches → click "..." next to rule → Delete
2. **Local hook:** `git config --global --unset core.hooksPath && rm -rf ~/.git-hooks`
3. **Pi install:** remove the `git:` line from `~/.pi/agent/settings.json`, restart Pi
4. **GitHub repo:** Settings → Danger Zone → Delete this repository
5. **Local commits not yet pushed:** `git reset --hard origin/main`

## Reference

- Pi extensions docs: https://pi.dev/
- GitHub branch protection: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule
- GitHub CODEOWNERS: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners
- GitHub Personal Access Tokens: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- Git pre-push hooks: https://git-scm.com/docs/githooks#_pre_push
