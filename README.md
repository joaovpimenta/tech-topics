# Tech Topics

A responsive editorial journal built as a static site for GitHub Pages.

## Repository operations

Start with `node scripts/doctor.mjs --json` for environment diagnostics and commands. The [agent navigation map](docs/agents/README.md) routes maintenance, editorial queue and local TTS tasks to their documentation. CI uses `.node-version` and validates the site and articles once on Ubuntu, matching the GitHub Pages runner. Python is optional for local site tasks; lightweight TTS tests require it in CI, without downloading speech models.

`node scripts/validate-site.mjs` validates and builds the public artifact in `dist/`. Pages deploys that directory; repository tooling and documentation stay outside the public package. Run `node scripts/build-site.mjs` to repackage an already-generated site, then serve `dist/` for publication parity.

## Installable app (PWA)

The manifest uses repository-relative URLs and standalone display. On Android Chrome, use **Install app** when offered, or the browser menu. On iPhone, use Safari → Share → **Add to Home Screen**. Installation depends on browser/platform support; this is not an App Store release.

The service worker downloads the app shell, article JSON files and covers after the first online visit. Once caching completes, they can be opened offline; embedded external resources still require a connection. Local article visuals are cached when requested under service-worker control. The network is preferred so new publications are not hidden by the cache. The build automatically versions the cache; no manual PWA update is needed for each article. Offline availability depends on the browser retaining site storage.

Scheduled publication reads a selected topic from the [editorial queue](docs/TOPIC_QUEUE.md). Weekly curation adds five topics to a GitHub issue; only after a push with a new article JSON has successfully deployed to Pages does a reusable job select the next unpublished topic. CSS/JS-only deploys do not trigger another editorial selection. This keeps editorial curation separate from article creation.

Articles are sorted by valid `publishedAt` dates, newest first, both during the build and in the browser. For articles published on the same day, the first-addition Git commit timestamp breaks ties (not the last edit). The workflow fetches full history for this purpose. Adding an article never replaces older articles.

## GitHub Pages setup

1. Create or open a GitHub repository and push this project to the `main` branch.
2. In **Settings → Pages**, set the source to **GitHub Actions**.
3. The included workflow deploys automatically on site-relevant pushes to `main` (docs/tooling-only changes are ignored) and can also be started manually from the **Actions** tab.

The site is a static multi-article archive. New articles use `content/articles/<slug>.md` as their editorial source, with YAML frontmatter and Markdown body. Existing `.json` articles remain supported as legacy inputs until a separately authorized conversion. Each article has its own cover image under `assets/`. The Pages workflow runs `node scripts/validate-site.mjs`, which compiles the mixed Markdown/JSON corpus and validates the site before publishing. The homepage loads every article in the folder and each card opens `article.html?slug=<slug>`.

## Article contract

Markdown frontmatter supplies the article metadata (`slug`, `language`, `title`, `category`, `date`, `publishedAt`, `read`, `image`, `alt`, `dek`, `excerpt` and canonical `tags`); the Markdown body is the source for the rendered article. The compiler also accepts legacy JSON records with `bodyHtml`. The `image` path must point to a committed local cover generated for that article. Use a unique URL-safe slug and never overwrite an existing article when adding a new topic. Articles are ordered newest first during the build.

Every cover must be a visibly painted editorial watercolor on textured paper, following `docs/VISUAL_STYLE.md`. Use `assets/<slug>/<slug>-cover.jpg` for covers. Use Mermaid when a technical diagram helps explain a relationship; do not create or version SVGs for diagrams. Existing SVG favicon and icon assets remain allowed.

## Composable article briefs

Article generation is split into a task, one to three domain frameworks and a compact authoring contract. The allowlisted modules live under `generation/`; deterministic format and security rules remain in lint and tests.

List the available modules and the compact catalog of published topics. Inspect full articles only when a candidate topic may overlap, then compose only what the current article needs:

```bash
node scripts/compose-article-brief.mjs --list
node scripts/compose-article-brief.mjs \
  --topic "Circuit Breaker" \
  --task explain-concept \
  --framework distributed-systems \
  --framework backend \
  --depth advanced
```

The brief is written to stdout and should not be committed. The composer has no external dependencies, does not call an LLM, and does not create an article: it selects and combines the requested task, frameworks and authoring contract for a separate writing step. There is no LLM provider, model selection, API call or automatic article-writing orchestration in this repository. Write the result to `content/articles/<slug>.md` using `generation/templates/article.md`; Markdown is the editorial source, and the site compiler turns it into the public HTML artifact. The composer rejects unknown modules, unsafe registry paths, oversized composition and exact topic duplicates. Once the opening paragraph is final, `node scripts/compose-cover-brief.mjs` emits the compact cover guidance from `docs/VISUAL_STYLE.md`.

### Public article audio

Kokoro ONNX FP32 with voice `pf_dora` is the only backend that generates published MP3 files; the browser's Web Speech API is a separate device playback option. The current Actions workflow has a global literal `false` effect gate, so manual runs, backfills, new-article synthesis and the normally permitted refresh of changed existing narration cannot generate audio. Normal CI uses lightweight simulated TTS checks and does not load the model or prove a real synthesis. Resuming generation requires an explicitly authorized workflow change; a real-generation proof would then require a successful synthesis run and review of its actual audio artifact. See [Kokoro Actions](docs/KOKORO_ACTIONS.md) for the precise controls and constraints.

## Local preview

```bash
node scripts/validate-site.mjs
python3 -m http.server 4173
```

Then open `http://localhost:4173`.


A validação determinística dos artigos roda localmente, na GitHub Action de Pull Requests e no job de validação do Pages em `main`. Ela cobre o contrato JSON, a estrutura da abertura, segurança do HTML, assets, Mermaid quando presente, tabelas roláveis e regras básicas de responsividade.


`node scripts/validate-site.mjs` é o comando único usado localmente, na validação de Pull Requests e antes do deploy. Ele evita que os workflows mantenham listas diferentes de verificações.
