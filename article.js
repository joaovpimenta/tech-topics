const params = new URLSearchParams(window.location.search);
const requestedSlug = params.get("slug");

function showArticle(article) {
  document.documentElement.lang = article.language || "pt-BR";
  document.title = `${article.title} — Tech Topics`;
  document.querySelector("#article-description").content = article.excerpt;
  document.querySelector("#article-category").textContent = article.category;
  document.querySelector("#article-heading").textContent = article.title;
  document.querySelector("#article-dek").textContent = article.dek || article.excerpt;
  document.querySelector("#article-meta").textContent = `Tech Topics · ${article.date} · ${article.read}`;
  const image = document.querySelector("#article-image");
  image.src = article.image;
  image.alt = article.alt || article.title;
  document.querySelector("#article-body").innerHTML = article.bodyHtml;
}

async function loadArticle() {
  try {
    const manifestResponse = await fetch("content/articles/index.json", { cache: "no-store" });
    if (!manifestResponse.ok) throw new Error("Article manifest unavailable");
    const manifest = await manifestResponse.json();
    const entry = manifest.find(item => item.slug === requestedSlug) || manifest[0];
    if (!entry) throw new Error("No articles found");
    const articleResponse = await fetch(entry.path, { cache: "no-store" });
    if (!articleResponse.ok) throw new Error("Article unavailable");
    showArticle(await articleResponse.json());
  } catch (error) {
    document.querySelector("#article-heading").textContent = "Article unavailable";
    document.querySelector("#article-body").innerHTML = "<p>We could not load this article. Return to the archive and try again.</p><p><a class=\"article-back\" href=\"index.html#recent-posts\">← Back to archive</a></p>";
  }
}

loadArticle();