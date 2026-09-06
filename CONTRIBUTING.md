# Contributing to Pi-Velpari

Repo-governance content for contributors. End-user install instructions live in [`README.md`](README.md).

## Branch protection (two layers)

Set both layers. They catch the mistake at different stages.

### Server layer (GitHub)

1. Open `https://github.com/<YourUser>/pi-velpari/settings/branches`
2. Click **Add rule** (or **Add classic branch protection rule**)
3. Branch name pattern: **`main`**
4. Check:
   - ☑ **Require a pull request before merging**
   - ☑ **Allow squash merging** (keeps history clean)
5. If solo: leave **Require approvals** unchecked (you cannot approve your own PR). See CODEOWNERS alternative below.
6. ☑ **Do not allow bypassing the above settings**
7. Click **Create**

### Local layer (pre-push hook)

A global hook blocks direct pushes to `main` or `master` on any repo.

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

**Important:** the file MUST be named exactly `pre-push` (not `global-pre-push` or `myhook`). Git looks for files by hook name.

### Verify both layers

```bash
# Test 1: local hook blocks (no network call needed)
git push origin main
# Expected: "BLOCKED: direct push to 'main' is not allowed."

# Test 2: feature branch push succeeds
git checkout -b test/protection-check
echo "" >> README.md
git commit -am "test: verify protection"
git push origin test/protection-check
# Expected: succeeds
```

## CODEOWNERS (optional, for self-merge with review)

For a stricter review gate that still allows self-merge, create `.github/CODEOWNERS`:

```
* @<YourGitHubUsername>
```

Then enable ☑ **Require review from Code Owners** in the GitHub branch-protection rule. You ARE the code owner, so self-approval works.

## First push (with PAT)

Generate a GitHub Personal Access Token at https://github.com/settings/tokens:

- Click **Generate new token** → **classic**
- Note: `pi-velpari push YYYY-MM-DD`
- Expiration: **7 days** (one-time use is fine)
- Scopes: check ONLY **`repo`**

Push:

```bash
git remote add origin https://github.com/<YourUser>/pi-velpari.git

# One-shot push with PAT inline
git push https://x-access-token:<PAT>@github.com/<YourUser>/pi-velpari.git main

# Reset remote URL to clean form (no PAT stored)
git remote set-url origin https://github.com/<YourUser>/pi-velpari.git
```

## Daily workflow

```bash
# 1. Start a feature branch
git checkout -b feat/something
# edit files...

# 2. Commit and push
git add -A
git commit -m "feat: something"
git push origin feat/something

# 3. Open PR in browser, merge on GitHub

# 4. Sync everywhere
git checkout main
git pull origin main
```

## Troubleshooting

### Pre-push hook not running

Symptom: `git push origin main` proceeds past the auth prompt without any `BLOCKED` message.

Fix: rename the hook file to exactly `pre-push`. Git looks for files in `core.hooksPath` with exact hook names.

```bash
mv ~/.git-hooks/global-pre-push ~/.git-hooks/pre-push
```

### Push rejected: `workflow` scope missing

Symptom: `refusing to allow a Personal Access Token to create or update workflow .github/workflows/...yml without workflow scope`

Fix: delete workflow files (most extension repos do not need them) or create a new PAT with `repo` AND `workflow` scopes.

```bash
git rm .github/workflows/*.yml
git commit -m "ci: remove GitHub Actions workflows"
git push
```

### Stale `.git/index.lock`

Fix: first confirm no real `git` process is running:

```bash
ps aux | grep "git " | grep -v grep
```

If only the bash tool runs are visible (and no real git push is pending), remove the lock:

```bash
rm .git/index.lock
```

## Reference

- Pi extensions docs: https://pi.dev/docs/latest/extensions
- GitHub branch protection: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule
- GitHub CODEOWNERS: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners
- GitHub Personal Access Tokens: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- Git pre-push hooks: https://git-scm.com/docs/githooks#_pre_push
