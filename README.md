# Tech Topics

A responsive editorial journal built as a static site for GitHub Pages.

## Repository operations

Start with `node scripts/doctor.mjs --json` for environment diagnostics and commands. The [agent navigation map](docs/agents/README.md) routes maintenance, editorial queue and local TTS tasks to their documentation. CI uses `.node-version` and validates the site and articles once on Ubuntu, matching the GitHub Pages runner. Python is optional for local site tasks; lightweight TTS tests require it in CI, without downloading speech models.

After `npm ci`, run `node scripts/validate-site.mjs` for the validation suite and a temporary HTML preview. `node scripts/build-site.mjs` builds the production artifact in `dist/` from committed inputs and full Git history. Pages deploys that directory; repository tooling and documentation stay outside the public package.

## Installable app (PWA)

The manifest uses repository-relative URLs and standalone display. On Android Chrome, use **Install app** when offered, or the browser menu. On iPhone, use Safari → Share → **Add to Home Screen**. Installation depends on browser/platform support; this is not an App Store release.

The service worker caches the app shell, compiled article HTML and selected assets. Cached pages can be opened offline after installation; external resources and audio may still need a connection. The worker serves its versioned cache first, keeping an open tab on a consistent version. An installed update waits for existing tabs to close before activation. Offline availability depends on the browser retaining site storage; see [the recovery guide](docs/migrations/pwa-recovery.md).

Scheduled publication reads a selected topic from the [editorial queue](docs/TOPIC_QUEUE.md). Topic selection after deployment is frozen during the migration. When enabled under the existing policy, selection follows a successfully deployed genuinely new article; converting an existing article does not count as a new publication.

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

The brief is written to stdout and should not be committed. The composer does not call an LLM or create an article: it selects and combines the requested task, frameworks and authoring contract for a separate writing step. There is no LLM provider, model selection, API call or automatic article-writing orchestration in this repository. Write the result to `content/articles/<slug>.md` using `generation/templates/article.md`; Markdown is the editorial source, and the site compiler turns it into the public HTML artifact. The composer rejects unknown modules, unsafe registry paths, oversized composition and exact topic duplicates. Once the opening paragraph is final, `node scripts/compose-cover-brief.mjs` emits the compact cover guidance from `docs/VISUAL_STYLE.md`.

The agent or human coordinating the work supplies the brief to a chosen model, checks the topic against the catalog, and reviews the resulting Markdown for accuracy, references, accessibility and pronunciation. Run `node scripts/validate-site.mjs`, inspect the HTML preview and obtain the editorial review required by [EDITORIAL.md](docs/EDITORIAL.md) and [PUBLISHING.md](docs/PUBLISHING.md) before publication. The model, research and human review are external steps; the composer and CI do not perform them automatically.

### Public article audio

Kokoro ONNX FP32 with voice `pf_dora` is the only backend that generates published MP3 files; the browser's Web Speech API is a separate device playback option. The current Actions workflow has a global literal `false` effect gate, so manual runs, backfills, new-article synthesis and the normally permitted refresh of changed existing narration cannot generate audio. Normal CI uses lightweight simulated TTS checks and does not load the model or prove a real synthesis. Resuming generation requires an explicitly authorized workflow change; a real-generation proof would then require a successful synthesis run and review of its actual audio artifact. See [Kokoro Actions](docs/KOKORO_ACTIONS.md) for the precise controls and constraints.

#### Isolated local TTS preview

For an authorized real Kokoro preview, run the following locally without calling Actions or changing a GitHub Release. The migration freeze remains in force until the workflow policy is changed. Start from a clean checkout of the committed revision you want to narrate. The TTS reader requires `dist/` to contain compiled HTML whose source SHA matches `HEAD`; the build below creates that local artifact but does not deploy it. Python 3.11, Node 22, `curl`, and FFmpeg with `libmp3lame` and `ffprobe` are required. The setup downloads about 354 MB of model and voice files and installs the Python packages; no GPU or API key is used. Inference runs locally on CPU with four ONNX threads.

```bash
npm ci
node scripts/build-site.mjs

TTS_PREVIEW_DIR=/tmp/tech-topics-tts-preview
mkdir -p "$TTS_PREVIEW_DIR"
python3.11 -m venv "$TTS_PREVIEW_DIR/venv"
"$TTS_PREVIEW_DIR/venv/bin/python" -m pip install \
  'kokoro-onnx==0.6.1' 'misaki-fork==0.9.6' \
  'phonemizer-fork==3.3.2' 'espeakng-loader==0.2.4' 'soundfile==0.13.1'

curl --fail --location --retry 3 --silent --show-error \
  'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx' \
  --output "$TTS_PREVIEW_DIR/kokoro-v1.0.onnx"
curl --fail --location --retry 3 --silent --show-error \
  'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin' \
  --output "$TTS_PREVIEW_DIR/voices-v1.0.bin"
printf '%s  %s\n' \
  'beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a' "$TTS_PREVIEW_DIR/kokoro-v1.0.onnx" \
  'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d' "$TTS_PREVIEW_DIR/voices-v1.0.bin" \
  | sha256sum --check

mkdir -p "$TTS_PREVIEW_DIR/output"
env OMP_NUM_THREADS=4 OPENBLAS_NUM_THREADS=4 \
  "$TTS_PREVIEW_DIR/venv/bin/python" tools/tts/kokoro_release.py prepare \
  --slug four-golden-signals --max-chars 1200 \
  --output-dir "$TTS_PREVIEW_DIR/output"
env OMP_NUM_THREADS=4 OPENBLAS_NUM_THREADS=4 \
  "$TTS_PREVIEW_DIR/venv/bin/python" tools/tts/kokoro_release.py synthesize \
  --slug four-golden-signals --output-dir "$TTS_PREVIEW_DIR/output" \
  --model "$TTS_PREVIEW_DIR/kokoro-v1.0.onnx" \
  --voices "$TTS_PREVIEW_DIR/voices-v1.0.bin"
ffmpeg -hide_banner -loglevel error -y \
  -i "$TTS_PREVIEW_DIR/output/four-golden-signals.wav" \
  -af 'loudnorm=I=-19:TP=-1:LRA=11' -ar 24000 -ac 1 \
  -c:a libmp3lame -b:a 128k \
  "$TTS_PREVIEW_DIR/output/four-golden-signals.mp3"
ffprobe -v error -show_entries format=duration,bit_rate \
  -show_entries stream=codec_name,sample_rate,channels -of json \
  "$TTS_PREVIEW_DIR/output/four-golden-signals.mp3"
```

The WAV, MP3, sentence-level `chapters.json`, segment plan and metrics stay under `/tmp/tech-topics-tts-preview/output`; no command above creates or replaces a Release. `--max-chars 1200` keeps complete text segments, so the sample can exceed 1,200 characters slightly. The generated `.md` file is boilerplate that says the audio came from GitHub Actions; for a local preview, do not publish that note. One verified run on source SHA `4516825` produced 91.64 seconds of audio in 155.50 seconds of synthesis with 15 sentence chapters. The manual Actions path remains blocked by the workflow gate described above.

## Local preview

```bash
node scripts/validate-site.mjs
mkdir -p /tmp/tech-topics-preview
node scripts/build-markdown-preview.mjs --output-dir /tmp/tech-topics-preview/site
cd /tmp/tech-topics-preview/site
python3 -m http.server 4173
```

Then open `http://localhost:4173`.


A validação determinística dos artigos roda localmente, na GitHub Action de Pull Requests e no job de validação do Pages em `main`. Ela cobre os contratos Markdown e legado, a estrutura da abertura, segurança do HTML, assets, Mermaid quando presente, tabelas roláveis e regras básicas de responsividade.


`node scripts/validate-site.mjs` é o comando único usado localmente, na validação de Pull Requests e antes do deploy. Ele evita que os workflows mantenham listas diferentes de verificações.
