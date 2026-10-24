# Version Control — FSG Bharat

Written 4 September 2026, immediately after the server + client LAN deployment.

---

## Why this matters now

Until this week there was one copy of the app, on one laptop, and sloppy version
control cost nothing. That changed. There are now **three installations sharing a
single PostgreSQL database**: this laptop, the server PC, and at least one client PC.

A shared database turns a local mistake into everyone's mistake.

---

## Rule 1 — Every machine must run the identical build

Not "a recent build". The **same** build.

This is not a style preference; it follows from how the app starts up.
`src/main/index.js` runs on every launch:

```js
await withStartupLock(async () => {
  await ensureSchema()
  await seedDefaultMapping()
  ...
})
```

`seedDefaultMapping()` reads `Mapping_v2.xlsx` **from that machine's own bundled
copy** (`process.resourcesPath`) and writes it into the **shared** database,
refreshing default rule set `id=1`.

So if the server's exe and a client's exe were built from different
`Mapping_v2.xlsx` files:

> every time someone launches the app, the shared default mapping is overwritten
> with whatever *that machine* happens to bundle.

The mapping silently changes depending on who opened the app last. Nobody gets an
error. Financials just come out different on different days. **This is the single
biggest risk in the current setup.**

The same logic applies to `ensureSchema()`. A newer exe migrates the shared
database on startup; older clients then run against a schema they were not built
for. Additive changes usually survive; anything else does not.

**Therefore:** when you ship a new build, ship it to *every* machine, and do it in
one sitting.

---

## Rule 2 — Never `git add -A` from the Desktop

The repository root is `C:\Users\Aditya Maheshwari\Desktop`, not this folder. It
tracks 80,942 files and 9.26 GiB, including personal photos, PDFs and zips.

`JE_Financial_App\.gitignore` now blocks `node_modules`, `dist`, `dist_new`,
`dist-final` and `out` — about 2 GB. It does **not** protect the rest of the
Desktop. Always stage explicit paths:

```bash
git add JE_Financial_App/src JE_Financial_App/package.json
```

Never `git add -A`, never `git add .` from the Desktop.

---

## Outstanding: the deployed build is not in git

`fsg-bharat 0.1.2` — the exe now running on the server and clients — **cannot be
rebuilt from this repository**. Missing:

| File | State | Why the build needs it |
|---|---|---|
| `package.json` | modified, uncommitted | carries the `fsg-bharat` name, version `0.1.2`, appId, tiptap deps, and the `itr-templates` bundling |
| `package-lock.json` | modified, uncommitted | pins the exact dependency tree that was built |
| `Mapping_v2.xlsx` | **untracked** | bundled into the exe; reseeds the shared DB on every startup |
| `itr-templates/` | **untracked** | bundled into the exe; ITR forms |
| `Prescribed_Format_Reference.html` | **untracked** | bundled into the exe |

To fix — run from the Desktop, staging explicit paths only:

```bash
git add JE_Financial_App/.gitignore JE_Financial_App/VERSION_CONTROL.md JE_Financial_App/package.json JE_Financial_App/package-lock.json JE_Financial_App/Mapping_v2.xlsx JE_Financial_App/Prescribed_Format_Reference.html JE_Financial_App/itr-templates
git commit -m "Release FSG Bharat 0.1.2 — the build deployed to server and clients"
git tag -a v0.1.2 -m "Deployed to server PC and client PCs, 4 Sep 2026"
```

After that, `git checkout v0.1.2` reproduces exactly what is running in the office.

---

## Release process, from here on

1. **Change code.** Commit in small, described steps.
2. **Bump the version** in `package.json` — `0.1.3`, `0.1.4`, … Never ship two
   different builds under one version number; that is what makes a bug report
   impossible to trace.
3. **Build:**
   ```bash
   npm run build && npx electron-builder --win --x64 -c.directories.output=dist-final
   ```
   Close the app first — electron-builder hangs forever, with no error, if the
   portable exe is locked by a running instance.
4. **Commit and tag:**
   ```bash
   git add JE_Financial_App/package.json
   git commit -m "Release 0.1.3 — <what changed>"
   git tag -a v0.1.3 -m "<what changed>"
   ```
5. **Roll out to every machine in one sitting** (Rule 1). Update the register below.
6. **Back up the database before any release that changes the schema:**
   ```bash
   pg_dump -h <server> -U vera_app -Fc -C -f vera_financial_pre_0.1.3.backup vera_financial
   ```

---

## Deployment register

Keep this current. When something misbehaves, the first question is always "which
build is that machine on?"

| Machine | Role | Version | Rolled out | Notes |
|---|---|---|---|---|
| This laptop | development | 0.1.5 | 4 Sep 2026 | source of truth for builds |
| Server PC | server + client | 0.1.4 | 4 Sep 2026 | **needs 0.1.5** — also hosts PostgreSQL 17 |
| Client PC | client | 0.1.2 | Sep 2026 | **needs 0.1.5** |

> **0.1.5 must go to every machine.** (0.1.3 superseded before rollout; 0.1.4 went to the server only.)
>  It changes how Opening/Closing Stock is
> read from Tally and how the Balance Sheet treats Stock-tab entries. Leaving a
> machine on 0.1.2 means two people can produce different financials from the
> same database — exactly the split Rule 1 exists to prevent.

---

## Known debt, deliberately deferred

Recorded so it is a decision rather than an oversight.

1. **GitHub token in plaintext.** `.git/config` holds the `origin` URL with a
   Personal Access Token embedded. Revoke it on GitHub and re-add the remote using
   Git Credential Manager or SSH.
2. **Repo rooted at the Desktop.** `git push` would upload ~9.26 GiB including 595
   personal photos, PDFs and documents to `github.com/adityasiliguri/JE_FINANCIAL_APP`.
   No remote-tracking refs exist, so this has not happened yet. **Do not push until
   the repository is re-rooted at this folder** (`git filter-repo
   --subdirectory-filter JE_Financial_App` preserves the app's history).
3. **No CI, no build provenance.** Builds are made by hand on this laptop. The tag
   is the only record of what a given exe contains — which is why step 4 above is
   not optional.
