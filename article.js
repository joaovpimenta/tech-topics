const params = new URLSearchParams(window.location.search);
const requestedSlug = params.get("slug");

function showArticle(article) {
  document.documentElement.lang = article.language || "pt-BR";
  document.title = `${article.title} — Tech Topics`;
  document.querySelector("#article-description").content = article.excerpt;
  document.querySelector("#article-category").textContent = article.category;
  document.querySelector("#article-heading").textContent = article.title;
  document.querySelector("#article-dek").textContent = article.dek || article.excerpt;
  const publishedAt = new Date(`${article.publishedAt}T00:00:00Z`);
  const date = Number.isNaN(publishedAt.getTime()) ? (article.date || "") : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" }).format(publishedAt);
  const details = [date];
  if (/\d/.test(article.read || "")) details.push(article.read);
  document.querySelector("#article-meta").textContent = details.filter(Boolean).join(" · ");
  const image = document.querySelector("#article-image");
  image.src = article.image;
  image.alt = article.alt || article.title;
  document.querySelector(".article-hero").hidden = false;
  document.querySelector("#article-body").innerHTML = article.bodyHtml;
  document.dispatchEvent(new Event("tech-topics:article-ready"));
}

async function loadArticle() {
  try {
    const manifestResponse = await fetch("content/articles/index.json", { cache: "no-store" });
    if (!manifestResponse.ok) throw new Error("Manifesto indisponível");
    const manifest = await manifestResponse.json();
    const entry = requestedSlug ? manifest.find(item => item.slug === requestedSlug) : manifest[0];
    if (!entry) throw new Error("Artigo não encontrado");
    const articleResponse = await fetch(entry.path, { cache: "no-store" });
    if (!articleResponse.ok) throw new Error("Artigo indisponível");
    showArticle(await articleResponse.json());
  } catch (error) {
    document.querySelector("#article-category").textContent = "Arquivo";
    document.querySelector("#article-heading").textContent = "Artigo indisponível";
    document.querySelector(".article-hero").hidden = true;
    document.querySelector("#article-body").innerHTML = "<p>Não foi possível carregar este artigo. Volte ao arquivo e tente novamente.</p><p><a class=\"article-back\" href=\"index.html#recent-posts\">← Todos os artigos</a></p>";
  }
}

loadArticle();
