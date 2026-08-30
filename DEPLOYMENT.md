# How to enable GitHub Pages for Growth OS (2-minute setup)

The deployment code is fully pushed to the `arena/01a05484-planner` branch of
https://github.com/joeeeee28/Planner — it just needs Pages switched on, which
requires **repo admin** access (the automation token can push code but cannot
change repo settings).

## Option A — GitHub web UI (easiest, ~30 seconds)

1. Open https://github.com/joeeeee28/Planner/settings/pages
2. Under **Build and deployment → Source**, select **Deploy from a branch**
3. Branch: `arena/01a05484-planner`, folder: `/ (root)` — Save
4. GitHub builds automatically and prints the URL, typically:
   **https://joeeeee28.github.io/Planner/**
5. Done. The app is served over HTTPS, fully responsive, data persists.

## Option B — REST API (if you have a token with admin rights)

```
curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" \
  https://api.github.com/repos/joeeeee28/Planner/pages \
  -d '{"source":{"branch":"arena/01a05484-planner","path":"/"}}'
```

## Option C — GitHub Actions (automatic deploys on every push)

The repo is pre-configured for this (relative `base: './'` so the build works
under the `/Planner/` subpath, plus a `deploy.yml` workflow ready to add):
push `.github/workflows/deploy.yml` once Pages is enabled and every future
push to `main` will rebuild + redeploy automatically.

## What is already verified in this sandbox

- Production build (`npm run build`) passes; assets are relative-path so the
  subpath hosting works.
- Production static server (`node server.mjs`, no dependencies) serves the
  build correctly (verified HTTP 200 for index, JS, CSS, favicon).
- The branch is pushed and its files are verifiable via the GitHub API.
- The GitHub Pages CDN itself is firewalled from this sandbox, so final
  in-browser verification of the live URL must be done from your browser —
  but the artifact is standard Vite static output (no localhost, no dev-only
  services, no backend), so it will behave identically under Pages.
