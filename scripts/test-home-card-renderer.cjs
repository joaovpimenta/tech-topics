const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { render, renderIntoHome } = require("../home-card-renderer.js");

async function main() {
  const catalog = JSON.parse(await readFile("assets/articles-catalog.json", "utf8"));
  const html = await readFile("index.html", "utf8");
  const match = html.match(/<!-- HOME_CARDS_START -->([\s\S]*?)<!-- HOME_CARDS_END -->/);
  assert(match, "home card markers must exist");
  const staticMarkup = match[1].trim();
  const expected = catalog.slice(0, 6).map((article, index) => render(article, index)).join("\n          ");
  assert.equal(staticMarkup, expected, "build HTML must exactly match the shared renderer and canonical catalog");
  assert.equal((staticMarkup.match(/class="recent-item"/g) || []).length, Math.min(6, catalog.length));
  assert.doesNotMatch(staticMarkup, /\son[a-z]+\s*=/i, "cards must not contain inline event handlers");
  assert.doesNotMatch(staticMarkup, /bodyHtml|article\.json/i, "home cards must not embed article bodies");

  const escaped = render({
    slug: "safe-slug", title: `Title <script>"'`, category: `Cat & <tag>`,
    image: "assets/safe.jpg", alt: `Alt "><svg onload=alert(1)>`, excerpt: `Text & <b>`, publishedAt: "2026-01-02"
  }, 0);
  assert.match(escaped, /Title &lt;script&gt;&quot;&#39;/);
  assert.match(escaped, /Cat &amp; &lt;tag&gt;/);
  assert.match(escaped, /Alt &quot;&gt;&lt;svg onload=alert\(1\)&gt;/);
  const untrustedContent = escaped.slice(0, escaped.indexOf('<div class="card-actions">'));
  assert.doesNotMatch(untrustedContent, /<(?:script|svg|b)\b/i, "metadata must not create HTML elements");
  assert.doesNotMatch(untrustedContent, /"\s+onload=/i, "metadata must not create event attributes");
  assert.throws(() => render({ slug: "../bad", image: "assets/a.jpg" }, 0), /slug/i);
  assert.throws(() => render({ slug: "valid", image: "../escape.jpg" }, 0), /relative image/i);

  const replacementTokens = "$& $` $'";
  const escapedReplacementTokens = "$&amp; $` $&#39;";
  const tokenArticle = {
    slug: "literal-replacement-tokens", title: `Title ${replacementTokens}`,
    category: "Test", image: "assets/literal-replacement-tokens/cover.jpg",
    alt: `Alt ${replacementTokens}`, excerpt: `Excerpt ${replacementTokens}`,
    publishedAt: "2026-01-02"
  };
  const shell = "<main><!-- HOME_CARDS_START -->old<!-- HOME_CARDS_END --></main>";
  const firstBuild = renderIntoHome(shell, [tokenArticle]);
  assert.equal((firstBuild.match(/HOME_CARDS_START/g) || []).length, 1, "replacement tokens must not duplicate the start marker");
  assert.equal((firstBuild.match(/HOME_CARDS_END/g) || []).length, 1, "replacement tokens must not duplicate the end marker");
  assert(firstBuild.includes(`Title ${escapedReplacementTokens}`), "title replacement tokens must remain literal");
  assert(firstBuild.includes(`alt="Alt ${escapedReplacementTokens}"`), "alt replacement tokens must remain literal in attributes");
  assert(firstBuild.includes(`Excerpt ${escapedReplacementTokens}`), "excerpt replacement tokens must remain literal");
  assert.equal(renderIntoHome(firstBuild, [tokenArticle]), firstBuild, "rebuilding an already generated home must be idempotent");
  console.log("PASS: static home cards match the shared renderer; metadata is escaped and URLs are constrained");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
