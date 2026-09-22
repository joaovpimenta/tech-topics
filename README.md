# Tech Topics

A responsive editorial journal built as a static site for GitHub Pages.

## Installable app (PWA)

The manifest uses repository-relative URLs and standalone display. On Android Chrome, use **Install app** when offered, or the browser menu. On iPhone, use Safari → Share → **Add to Home Screen**. Installation depends on browser/platform support; this is not an App Store release.

The service worker downloads the app shell, article JSON files and covers after the first online visit. Once caching completes, they can be opened offline; embedded external resources still require a connection. Local article visuals are cached when requested under service-worker control. The network is preferred so new publications are not hidden by the cache. The build automatically versions the cache; no manual PWA update is needed for each article. Offline availability depends on the browser retaining site storage.

Articles are sorted by valid `publishedAt` dates, newest first, both during the build and in the browser. For articles published on the same day, the first-addition Git commit timestamp breaks ties (not the last edit). The workflow fetches full history for this purpose. Adding an article never replaces older articles.

## GitHub Pages setup

1. Create or open a GitHub repository and push this project to the `main` branch.
2. In **Settings → Pages**, set the source to **GitHub Actions**.
3. The included workflow deploys automatically on every push to `main` and can also be started manually from the **Actions** tab.

The site is a static multi-article archive. Each article lives in `content/articles/<slug>.json` and has its own cover image under `assets/`. The Pages workflow runs `node scripts/build-articles.mjs`, validates the article files and rebuilds `content/articles/index.json` before publishing. The homepage then loads every article in the folder and each card opens `article.html?slug=<slug>`.

## Article contract

Every article JSON must include `slug`, `language`, `title`, `category`, `date`, `publishedAt` (ISO `YYYY-MM-DD`), `read`, `image`, `alt`, `dek`, `excerpt` and `bodyHtml`. The `image` path must point to a committed local cover generated for that article. Use a unique URL-safe slug and never overwrite an existing article when adding a new topic. Articles are ordered newest first during the build.

Every cover must be a visibly painted editorial watercolor on textured paper, following `docs/VISUAL_STYLE.md`. Use `assets/<slug>/<slug>-cover.jpg` for covers. Use Mermaid for technical diagrams and charts; do not create or version SVGs for diagrams. Existing SVG favicon and icon assets remain allowed.

## Composable article briefs

Article generation is split into a task, one to three domain frameworks and a compact authoring contract. The allowlisted modules live under `generation/`; deterministic format and security rules remain in lint and tests.

List the available modules and compose only what the current article needs:

```bash
node scripts/compose-article-brief.mjs --list
node scripts/compose-article-brief.mjs \
  --topic "Circuit Breaker" \
  --task explain-concept \
  --framework distributed-systems \
  --framework backend \
  --depth advanced
```

The brief is written to stdout and should not be committed. The composer has no external dependencies, does not call an LLM and rejects unknown modules, unsafe registry paths, oversized composition and exact topic duplicates.

## Local preview

```bash
node scripts/validate-site.mjs
python3 -m http.server 4173
```

Then open `http://localhost:4173`.


A validação determinística dos artigos roda localmente e na GitHub Action de Pull Requests. Ela cobre o contrato JSON, a estrutura da abertura, segurança do HTML, assets, Mermaid, tabelas roláveis e regras básicas de responsividade.


`node scripts/validate-site.mjs` é o comando único usado localmente, na validação de Pull Requests e antes do deploy. Ele evita que os workflows mantenham listas diferentes de verificações.
