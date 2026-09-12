# Tech Topics

A responsive editorial journal built as a static site for GitHub Pages.

## GitHub Pages setup

1. Create or open a GitHub repository and push this project to the `main` branch.
2. In **Settings → Pages**, set the source to **GitHub Actions**.
3. The included workflow deploys automatically on every push to `main` and can also be started manually from the **Actions** tab.

The site is a static multi-article archive. Each article lives in `content/articles/<slug>.json` and has its own cover image under `assets/`. The Pages workflow runs `node scripts/build-articles.mjs`, validates the article files and rebuilds `content/articles/index.json` before publishing. The homepage then loads every article in the folder and each card opens `article.html?slug=<slug>`.

## Article contract

Every article JSON must include `slug`, `language`, `title`, `category`, `date`, `read`, `image`, `alt`, `dek`, `excerpt` and `bodyHtml`. The `image` path must point to a committed local cover generated for that article. Use a unique URL-safe slug and never overwrite an existing article when adding a new topic.

## Local preview

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.