const imageBase = "https://merinda.alithemes.net/wp-content/uploads/";
const goldenSignals = {
  title: "Four Golden Signals — Guia Interativo",
  image: "assets/four-golden-signals-cover.jpg",
  category: "Arquitetura, SRE",
  date: "Updated today",
  read: "Interactive guide",
  excerpt: "Um guia interativo de arquitetura e SRE sobre Latência, Tráfego, Erros e Saturação, com simuladores, PromQL, SLOs e error budget."
};

const stories = [goldenSignals];

const spotlightSlides = [
  { title: goldenSignals.title, image: goldenSignals.image, excerpt: "Explore Latency, Traffic, Errors and Saturation with an interactive architecture guide, PromQL examples, SLOs and error-budget thinking." }
];

const meta = story => `<div class="byline">Tech Topics <span>in</span> ${story.category}</div><div class="post-meta">${story.date} <i>·</i> ${story.read} <span class="star">★</span></div>`;

function renderArchive() {
document.querySelector(".quick-stories").innerHTML = stories.slice(0, 4).map(story => `
  <article class="quick-story">
    <a class="thumb image-link" href="article.html"><img src="${story.image}" alt="${story.title}" /></a>
    <div><h3><a href="article.html">${story.title}</a></h3>${meta(story)}</div>
  </article>`).join("");

document.querySelector("#editor-list").innerHTML = stories.slice(0, 4).map((story, index) => `
  <article class="editor-item">
    <div class="editor-number">0${index + 1}</div>
    <div><h3><a href="article.html">${story.title}</a></h3>${meta(story)}</div>
  </article>`).join("");

document.querySelector("#highlight-list").innerHTML = stories.slice(0, 4).map(story => `
  <article class="highlight-card">
    <a class="highlight-image image-link" href="article.html"><img src="${story.image}" alt="${story.title}" /></a>
    <div class="highlight-copy"><h3><a href="article.html">${story.title}</a></h3><p>${story.excerpt}</p>${meta(story)}</div>
  </article>`).join("");

document.querySelector("#recent-list").innerHTML = stories.map(story => `
  <article class="recent-item">
    <div class="recent-copy"><span class="eyebrow">Picked by editor</span><h3><a href="article.html">${story.title}</a></h3><p>${story.excerpt}</p>${meta(story)}</div>
    <a class="recent-image image-link" href="article.html"><img src="${story.image}" alt="${story.title}" /></a>
  </article>`).join("");
}

renderArchive();

async function loadArchive() {
  try {
    const response = await fetch("content/archive.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Archive unavailable");
    const archive = await response.json();
    if (!Array.isArray(archive) || archive.length === 0) throw new Error("Archive is empty");
    stories.splice(0, stories.length, ...archive);
    renderArchive();
  } catch (error) {
    // The built-in fallback keeps local file previews usable.
  }
}

loadArchive();

let currentSlide = 0;
const spotlightTitle = document.querySelector("#spotlight-title");
const spotlightExcerpt = document.querySelector("#spotlight-excerpt");
const spotlightImage = document.querySelector("#spotlight-image");
function renderSlide(index) {
  const slide = spotlightSlides[index];
  spotlightTitle.textContent = slide.title;
  spotlightExcerpt.textContent = slide.excerpt;
  spotlightImage.src = slide.image;
  spotlightImage.alt = slide.title;
}
document.querySelector("#previous-slide").addEventListener("click", () => {
  currentSlide = (currentSlide - 1 + spotlightSlides.length) % spotlightSlides.length;
  renderSlide(currentSlide);
});
document.querySelector("#next-slide").addEventListener("click", () => {
  currentSlide = (currentSlide + 1) % spotlightSlides.length;
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
  const matches = query ? stories.filter(story => `${story.title} ${story.category}`.toLowerCase().includes(query)).slice(0, 5) : [];
  searchResults.innerHTML = matches.map(story => `<a class="search-result" href="article.html"><strong>${story.title}</strong><small>${story.category} · ${story.date}</small></a>`).join("") || (query ? `<p class="post-meta">No stories found. Try another phrase.</p>` : "");
});