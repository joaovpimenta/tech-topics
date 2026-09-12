const fallbackArticle = {
  slug: "four-golden-signals",
  title: "Four Golden Signals — Guia Interativo",
  image: "assets/four-golden-signals-cover.jpg",
  alt: "Abstract illustration of the Four Golden Signals",
  category: "Arquitetura, SRE",
  date: "Updated today",
  read: "Interactive guide",
  excerpt: "Um guia interativo de arquitetura e SRE sobre Latência, Tráfego, Erros e Saturação, com simuladores, PromQL, SLOs e error budget."
};

const articles = [];
const articleUrl = article => `article.html?slug=${encodeURIComponent(article.slug)}`;
const meta = article => `${article.date} <i>·</i> ${article.read} <span class="star">★</span>`;
const byline = article => `<div class="byline">Tech Topics <span>in</span> ${article.category}</div><div class="post-meta">${meta(article)}</div>`;

function setLink(element, article) {
  element.href = articleUrl(article);
}

function renderFeatured(article) {
  const leadLink = document.querySelector("#lead-link");
  const leadImage = document.querySelector("#lead-image");
  const leadTitle = document.querySelector("#lead-title");
  setLink(leadLink, article);
  setLink(leadTitle, article);
  leadImage.src = article.image;
  leadImage.alt = article.alt || article.title;
  leadLink.setAttribute("aria-label", `Read ${article.title}`);
  leadTitle.textContent = article.title;
  document.querySelector("#lead-excerpt").textContent = article.excerpt;
  document.querySelector("#lead-category").textContent = article.category;
  document.querySelector("#lead-meta").innerHTML = meta(article);
}

function renderSlide(index) {
  const article = articles[index];
  if (!article) return;
  const link = document.querySelector("#spotlight-link");
  setLink(link, article);
  document.querySelector("#spotlight-title").textContent = article.title;
  document.querySelector("#spotlight-excerpt").textContent = article.excerpt;
  document.querySelector("#spotlight-category").textContent = article.category;
  document.querySelector("#spotlight-meta").innerHTML = meta(article);
  const image = document.querySelector("#spotlight-image");
  image.src = article.image;
  image.alt = article.alt || article.title;
}

function renderArchive() {
  document.querySelector(".quick-stories").innerHTML = articles.slice(0, 4).map(article => `
    <article class="quick-story">
      <a class="thumb image-link" href="${articleUrl(article)}"><img src="${article.image}" alt="${article.alt || article.title}" /></a>
      <div><h3><a href="${articleUrl(article)}">${article.title}</a></h3>${byline(article)}</div>
    </article>`).join("");

  document.querySelector("#editor-list").innerHTML = articles.slice(0, 4).map((article, index) => `
    <article class="editor-item">
      <div class="editor-number">${String(index + 1).padStart(2, "0")}</div>
      <div><h3><a href="${articleUrl(article)}">${article.title}</a></h3>${byline(article)}</div>
    </article>`).join("");

  document.querySelector("#highlight-list").innerHTML = articles.map(article => `
    <article class="highlight-card">
      <a class="highlight-image image-link" href="${articleUrl(article)}"><img src="${article.image}" alt="${article.alt || article.title}" /></a>
      <div class="highlight-copy"><h3><a href="${articleUrl(article)}">${article.title}</a></h3><p>${article.excerpt}</p>${byline(article)}</div>
    </article>`).join("");

  document.querySelector("#recent-list").innerHTML = articles.map(article => `
    <article class="recent-item">
      <div class="recent-copy"><span class="eyebrow">Picked by editor</span><h3><a href="${articleUrl(article)}">${article.title}</a></h3><p>${article.excerpt}</p>${byline(article)}</div>
      <a class="recent-image image-link" href="${articleUrl(article)}"><img src="${article.image}" alt="${article.alt || article.title}" /></a>
    </article>`).join("");

  const trending = articles[articles.length - 1];
  if (trending) {
    setLink(document.querySelector("#trending-link"), trending);
    setLink(document.querySelector("#trending-title"), trending);
    document.querySelector("#trending-title").textContent = trending.title;
    document.querySelector("#trending-category").textContent = trending.category;
    document.querySelector("#trending-meta").innerHTML = meta(trending);
    const image = document.querySelector("#trending-image");
    image.src = trending.image;
    image.alt = trending.alt || trending.title;
  }
}

renderFeatured(fallbackArticle);
articles.push(fallbackArticle);
renderArchive();
renderSlide(0);

async function loadArticles() {
  try {
    const manifestResponse = await fetch("content/articles/index.json", { cache: "no-store" });
    if (!manifestResponse.ok) throw new Error("Article manifest unavailable");
    const manifest = await manifestResponse.json();
    const loaded = await Promise.all(manifest.map(entry => fetch(entry.path, { cache: "no-store" }).then(response => {
      if (!response.ok) throw new Error(`Article unavailable: ${entry.slug}`);
      return response.json();
    })));
    if (!loaded.length) throw new Error("Article folder is empty");
    articles.splice(0, articles.length, ...loaded);
    renderFeatured(articles[0]);
    renderArchive();
    renderSlide(0);
  } catch (error) {
    // The fallback keeps the homepage usable before a local build is run.
  }
}

loadArticles();

let currentSlide = 0;
document.querySelector("#previous-slide").addEventListener("click", () => {
  currentSlide = (currentSlide - 1 + articles.length) % articles.length;
  renderSlide(currentSlide);
});
document.querySelector("#next-slide").addEventListener("click", () => {
  currentSlide = (currentSlide + 1) % articles.length;
  renderSlide(currentSlide);
});

const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");
menuToggle.addEventListener("click", () => {
  const open = mainNav.classList.toggle("is-open");
  menuToggle.setAttribute("aria-expanded", String(open));
});

const searchModal = document.querySelector(".search-modal");
const searchInput = document.querySelector("#search-input");
const searchResults = document.querySelector("#search-results");
function setSearchOpen(open) {
  searchModal.classList.toggle("is-open", open);
  searchModal.setAttribute("aria-hidden", String(!open));
  if (open) { searchInput.value = ""; searchResults.innerHTML = ""; setTimeout(() => searchInput.focus(), 80); }
}
document.querySelector(".search-trigger").addEventListener("click", () => setSearchOpen(true));
document.querySelector(".modal-close").addEventListener("click", () => setSearchOpen(false));
searchModal.addEventListener("click", event => { if (event.target === searchModal) setSearchOpen(false); });
document.addEventListener("keydown", event => { if (event.key === "Escape") setSearchOpen(false); });
searchInput.addEventListener("input", event => {
  const query = event.target.value.toLowerCase().trim();
  const matches = query ? articles.filter(article => `${article.title} ${article.category} ${article.excerpt}`.toLowerCase().includes(query)).slice(0, 8) : [];
  searchResults.innerHTML = matches.map(article => `<a class="search-result" href="${articleUrl(article)}"><strong>${article.title}</strong><small>${article.category} · ${article.date}</small></a>`).join("") || (query ? `<p class="post-meta">No articles found. Try another phrase.</p>` : "");
});