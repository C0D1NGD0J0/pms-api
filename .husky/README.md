# Git Hooks & Dependency Security

[Husky](https://typicode.github.io/husky/) runs checks before commits and pushes.
Hooks are installed by the `prepare` script when you run `npm install`.

pms-ui has the same setup, described in `pms-ui/.husky/README.md`; keep the two
in step.

## pre-commit

`npx lint-staged`: lints and formats only the staged files.

## pre-push

Runs in this order and stops at the first failure:

| Check          | Command                                                 | Why                                                                                                            |
| -------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Security audit | `node .husky/audit-prod.js`                             | Blocks high/critical advisories in production dependencies, except reviewed entries in `.audit-allowlist.json` |
| Format         | `npm run prettier:check`                                |                                                                                                                |
| Lint           | `npm run lint`                                          |                                                                                                                |
| Type check     | `npx tsc --noEmit -p tsconfig.json`                     | Includes `tests/`, which jest transpiles without type-checking                                                 |
| Affected tests | `npx jest --changedSince=origin/main --passWithNoTests` | Only tests touched by files changed against `main`                                                             |

## Dependency security

| Piece               | File                         | Why                                                                                                                                                                                                                      |
| ------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exact versions      | `package.json`               | No `^`/`~` ranges, so `npm install` can't pull a newer (possibly compromised) release                                                                                                                                    |
| npm settings        | `.npmrc`                     | `save-exact=true` pins anything you add; `package-lock=true` always writes the lockfile; `min-release-age=7d` refuses releases younger than 7 days (most hijacked releases are caught and pulled within that time) |
| Lockfile            | `package-lock.json`          | Exact version + integrity hash of every package. Never delete or ignore it                                                                                                                                               |
| Overrides           | `package.json` → `overrides` | Forces a patched version of a transitive dependency when the direct dependency hasn't caught up (e.g. `follow-redirects`)                                                                                                |
| Pre-push audit      | `.husky/audit-prod.js`       | See below                                                                                                                                                                                                                |
| Reviewed exceptions | `.audit-allowlist.json`      | Advisories judged to have no exploit path here, each with a reason and an expiry date                                                                                                                                    |

A previous `.npmrc` had `audit=false`, which silently turned off audits on every
`npm install`. It was removed; don't add it back. CI installs with `npm ci` only.

### How the audit works

`audit-prod.js` runs `npm audit --omit=dev --json` and fails when any production
dependency has a high or critical advisory, **unless** that advisory is listed in
`.audit-allowlist.json` and its `reviewBy` date hasn't passed.

- Only the advisories themselves are judged. Packages flagged only because they
  depend on an allow-listed package (e.g. awilix → fast-glob → micromatch → braces)
  pass too.
- Moderate and low advisories never block.
- Allowed advisories are printed on every push (`⚠️ Allowed …`), so they stay visible.
- An expired entry blocks again and prints `⏰ … expired — re-review it`.

pms-ui uses a copy of this script. Change both together.

### When the audit blocks a push

Work down this list; stop at the first step that works.

1. **See what's flagged:** `npm audit --omit=dev`
2. **Safe automatic fix:** `npm audit fix` (no major-version bumps). Commit
   `package.json` + `package-lock.json`.
3. **Patched version exists, but a parent pins the old one:** bump the
   `overrides` entry in `package.json` to the first patched version, then
   `npm install`. Check its publish date against `min-release-age`
   (`npm view <pkg> time --json`).
4. **Only fix is a major upgrade** (`npm audit fix --force`): check that the
   upgrade actually removes the vulnerable package
   (`npm view <pkg>@<version> dependencies`). npm sometimes suggests one that
   doesn't. Do it as its own PR.
5. **No fix exists and there's no exploit path:** add an allowlist entry.

Don't push with `--no-verify` to get round the audit.

### Adding an allowlist entry

Only when **no patched release exists** (or the only "fix" doesn't remove the
package) **and** you can say why it can't be exploited here, e.g. the vulnerable
function is never called, or no user input reaches it.

```json
{
  "id": "GHSA-xxxx-xxxx-xxxx",
  "package": "name",
  "reason": "Why there's no fix, how the package is reached, and why it can't be exploited here.",
  "addedOn": "YYYY-MM-DD",
  "reviewBy": "YYYY-MM-DD"
}
```

- `id` is the GHSA id from the advisory URL.
- Set `reviewBy` about **3 months** out. When it passes, the push blocks again:
  check for a patched release, then fix it, or renew the date with an updated reason.
- Mention the entry in the PR description.

### Current allowlist entries

| Advisory                    | Package   | Why it's allowed                                                                                                                                                 | Review by  |
| --------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| GHSA-vfj7-8cjw-p6xm         | braces    | No patched release (3.0.3 is affected). Reached only via awilix → fast-glob → micromatch, used by `awilix.loadModules`/`listModules`, which the app never calls | 2027-01-21 |
| GHSA-fc5q-39xc-vjpf (ReDoS) | picomatch | No patched release (4.0.7 is affected). Same awilix → fast-glob → micromatch path; container registrations are explicit and no user input reaches a glob        | 2027-02-18 |

### Adding or updating packages

```sh
npm install <package>                 # pinned automatically (save-exact)
npm install <package>@<exact-version> # update one package
```

Never run `npm update`; it upgrades within ranges and gets round the pinning.
Update packages one at a time and run the tests after each. Once a month, run
`npm outdated` and `npm audit`.

## Bypassing hooks

`git commit --no-verify` / `git push --no-verify` skip the hooks. Use them only in
an emergency, never to get past a failing audit.
