# Growth OS — Deployment Guide

The app is ready to deploy to GitHub Pages. The **built site is already pushed** to the
`gh-pages` branch of this repository — only the Pages source setting needs to point at it.

## Live URL (after the step below)

**https://joeeeee28.github.io/Planner/**

## The one remaining step (repo owner, ~20 seconds)

1. Open **https://github.com/joeeeee28/Planner/settings/pages**
2. Under **Build and deployment → Source**, select **Deploy from a branch**
3. Branch: `gh-pages` · Folder: `/ (root)` → **Save**
4. GitHub rebuilds in ~1 minute; the app goes live at
   **https://joeeeee28.github.io/Planner/** (HTTPS, responsive, refresh-safe data).

> ⚠️ Do **not** point Pages at `main` or `arena/01a05484-planner` — those branches contain
> the *source code* (the Vite dev entry), not the built site. The `gh-pages` branch is an
> orphan branch containing only the compiled `dist/` output (index.html + assets + .nojekyll).

## What is already done & verified

- ✅ Production build passes (`npm run build`), assets use relative paths so the
  `/Planner/` subpath works.
- ✅ Built site pushed to `gh-pages` (verified: `index.html` + hashed assets + `.nojekyll`).
- ✅ No localhost / dev-only services anywhere in the built app — pure static SPA,
  data persists in the browser's localStorage.
- ✅ `node server.mjs` production server serves the build correctly (smoke-tested).
- ✅ Logic tests (`npm test`), TypeScript, lint all green.

## Future deploys

After the initial setup, to publish updates: rebuild (`npm run build`) and push the new
`dist/` output to `gh-pages`:

```bash
npm run build
git worktree add --detach /tmp/gh-pages-out HEAD
cd /tmp/gh-pages-out && rm -rf assets index.html favicon.svg icons.svg .nojekyll
cp -r ../dist/. .
git add -A && git commit -m "deploy: update site"
git push origin HEAD:refs/heads/gh-pages
cd .. && git worktree remove /tmp/gh-pages-out --force
```

(Or add the ready-made GitHub Actions workflow `.github/workflows/deploy.yml` once the
repo owner grants `workflows` permission — then every push to `main` deploys automatically.)

## Troubleshooting

| Symptom | Fix |
|---|---|
| “There isn't a GitHub Pages site here” | Pages not enabled yet, or the last build failed — check Settings → Pages and the Actions/Pages build log. |
| Page loads but app is blank | Source branch is a source-code branch (e.g. `main`/`arena/…`) — switch to `gh-pages`. |
| Stale content after a deploy | GitHub Pages caches for a few minutes; hard-refresh. |
