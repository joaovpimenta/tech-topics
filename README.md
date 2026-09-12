# Daily

A responsive editorial journal built as a static site for GitHub Pages.

## GitHub Pages setup

1. Create or open a GitHub repository and push this project to the `main` branch.
2. In **Settings → Pages**, set the source to **GitHub Actions**.
3. The included workflow deploys automatically on every push to `main` and can also be started manually from the **Actions** tab.

The site is intentionally build-free: GitHub Pages serves `index.html` directly. Archive entries live in `content/archive.json`, so a scheduled task can update the text archive and commit the changes without needing a build step.

## Local preview

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.
