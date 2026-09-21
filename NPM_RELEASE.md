# NPM Release Instructions — pi-velpari

Step-by-step guide for publishing `@adi-mudi/pi-velpari` to npm. Designed for one-command publishing with WebAuthn (security-key) approval. No git push required.

---

## 1. Pre-flight (5 checks, ~30 seconds)

Run these BEFORE bumping the version:

```bash
cd /mnt/Just_Do_It/02_Devp_Soft/12_orchestra/pi-velpari

# 1. Confirm you are logged in
npm whoami
# expect: adi-mudi

# 2. Confirm git state
git status
# expect: "nothing to commit, working tree clean"
#          (any modified files = check before publishing)
git branch --show-current
# expect: development

# 3. Confirm CHANGELOG.md has no unresolved merge conflicts
grep -n "<<<<<<< \|======= \|>>>>>>> " CHANGELOG.md \
  && echo "STOP — resolve CHANGELOG conflict before publishing" \
  || echo "OK — no conflict markers"

# 4. Confirm package.json parses
node -e "console.log(require('./package.json').version)"
# expect: 1.4.0-dev.1 (or whatever you have)

# 5. Confirm latest dist-tags
npm view @adi-mudi/pi-velpari dist-tags
# expect: { latest: '1.0.1', dev: '<previous>' }
```

If any check fails, fix it before continuing.

---

## 2. Bump the version (if needed)

Edit `package.json`:

```json
"version": "1.4.0-dev.1"
```

Version + tag convention:

| Version pattern | Dist-tag | Audience |
| --- | --- | --- |
| `1.4.0-dev.1`, `1.4.0-dev.2` | `dev` | active development snapshot |
| `1.4.0-rc.1`, `1.4.0-rc.2` | `rc` | release candidate |
| `1.4.0` (final) | `latest` | stable release |

---

## 3. Publish (the only command you need)

```bash
cd /mnt/Just_Do_It/02_Devp_Soft/12_orchestra/pi-velpari
npm publish --tag dev
```

What happens:

1. npm builds the tarball from your current working directory (filtered by `.npmignore`)
2. npm prints the package contents (file list)
3. npm prints an auth URL:
   ```
   Authenticate your account at:
   https://www.npmjs.com/auth/cli/<token>
   Press ENTER to open in the browser...
   ```
4. **Press ENTER** — your default browser opens the URL
5. In the browser: click **Use security key** → tap your Yubikey / Touch ID / Windows Hello
6. Browser tab auto-closes when approved
7. npm prints `+ @adi-mudi/pi-velpari@<version>` and exits

Total time: ~30 seconds once you tap the security key.

The `--tag dev` flag ensures the `dev` dist-tag points to your new version (prevents accidentally promoting a dev snapshot to `latest`).

---

## 4. Verify

```bash
# Confirm the new version is reachable under the dev tag
npm view @adi-mudi/pi-velpari@dev version
# expect: <your-bumped-version>

# Confirm full dist-tag map
npm view @adi-mudi/pi-velpari dist-tags
# expect: { latest: '<stable>', dev: '<your-version>', ... }
```

---

## 5. Optional — Add a custom alias tag

If you want a feature-specific alias (e.g., for the brainstorming v3 work):

```bash
npm dist-tag add @adi-mudi/pi-velpari@<version> <tag-name>
# example:
npm dist-tag add @adi-mudi/pi-velpari@1.4.0-dev.1 brainstorm-v3
```

Same WebAuthn flow as publish. No re-publish needed — dist-tags are pure metadata.

To remove a tag you no longer want:

```bash
npm dist-tag rm @adi-mudi/pi-velpari <tag-name>
```

---

## Troubleshooting

| Error | Cause | Fix |
| --- | --- | --- |
| `EOTP` "one-time password" | WebAuthn URL was redacted in some AI-tool output | Run the publish command in your **local terminal** — the URL is visible there, not when piped through AI tooling |
| `EPUBLISHCONFLICT` | That version already exists on npm | Bump `package.json` version and re-run |
| `ENEEDAUTH` "need auth" | Login session expired | `npm login --auth-type=web`, then retry |
| `ETARGET` / `EBADENGINE` | Node version mismatch | `engines.node: ">=22"` is required — check `node --version` |
| `npm warn publish repository.url normalized` | Auto-fix from `https://...` to `git+https://...` | Harmless. Run `npm pkg fix` to clean up |
| Tarball contains a CHANGELOG.md with `<<<<<<<` markers | Forgot to resolve merge conflict | Fix CHANGELOG.md in working tree (npm publishes from working tree, not git) |
| Tarball contains files you didn't expect | `.npmignore` is missing rules | Edit `.npmignore`, then `npm pack --dry-run` to verify |

---

## Common gotchas

1. **npm publishes the working tree, not git.** Whatever is in your local files right now is what gets shipped. A clean `git status` does not guarantee a clean tarball. Run `npm pack --dry-run` if unsure.

2. **The `dev` tag does not block `latest`.** Publishing with `--tag dev` leaves `latest` pointing at the previous stable. Stable users are unaffected.

3. **WebAuthn approval is per-publish, not persistent.** Each `npm publish` triggers a fresh browser approval. Within ~2 hours the same session may be reused, but count on approving every time.

4. **No git push required.** This workflow stays local. CI / Trusted Publishing is a separate path (the `publish-dev` GitHub Actions workflow) and is opt-in.

5. **Branch does not matter to npm.** `npm publish` does not check git branch. You can publish from `development`, `main`, any feature branch, or no branch at all. The branch convention is for humans; the version + dist-tag is for users.

---

## See also

- `velpari-full-sequence.md` — full stage sequence overview
- `Doc/velpari-sequence/` — published sequence doc set (README as entry)
- `.github/workflows/publish-dev.yml` — CI publish workflow (Trusted Publishing via OIDC, alternative to local publish)
