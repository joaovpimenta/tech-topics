const imageBase = "https://merinda.alithemes.net/wp-content/uploads/";

const stories = [
  {
    title: "Coffee vs. beer: which drink makes you more creative?",
    image: `${imageBase}2019/01/nemo-img-6.jpg`,
    category: "Living , Politics",
    date: "Feb 6",
    read: "2 mins read",
    excerpt: "Among emphatic normal cowered busted athletically some noticeably while and inside near towards unexpected much..."
  },
  {
    title: "Fully Automated Luxury Communism Isn’t Our Future",
    image: `${imageBase}2019/01/nemo-img-1.jpg`,
    category: "Trending",
    date: "Feb 4",
    read: "2 mins read",
    excerpt: "Froze hey more frog oyster far hound climbed that inappreciably the vital unicorn wrong because and jaguar..."
  },
  {
    title: "The highlight quote for this week",
    image: `${imageBase}2019/02/nemo-img-12.jpg`,
    category: "Living",
    date: "Feb 4",
    read: "1 min read",
    excerpt: "Haltered pill the forceful the ouch compactly dear and hit unbound so ouch clumsily forbidding fish..."
  },
  {
    title: "The future of wine: No Corks, No Vintages",
    image: `${imageBase}2019/01/nemo-img-2.jpg`,
    category: "Politics , Travel",
    date: "Jan 28",
    read: "2 mins read",
    excerpt: "In but toucan komodo alas more up jeez dog loaded ravingly porcupine exuberant fortuitous unstinting..."
  },
  {
    title: "Scientists Are Working on a Pill for Loneliness",
    image: `${imageBase}2019/01/nemo-img-7.jpg`,
    category: "Lifestyle",
    date: "Jan 24",
    read: "2 mins read",
    excerpt: "Macaw well goodness however saucy carelessly taut far smelled dear kiwi drew badger towards oh..."
  },
  {
    title: "Shallow work and physician burnout",
    image: `${imageBase}2019/01/nemo-img-3.png`,
    category: "Travel",
    date: "Jan 24",
    read: "2 mins read",
    excerpt: "Forgave criminal anteater parrot much fallible goodness hence fluent ahead much waked some thus..."
  },
  {
    title: "The Power of Flexibility",
    image: `${imageBase}2019/01/nemo-img-8.jpg`,
    category: "Living",
    date: "Jan 24",
    read: "2 mins read",
    excerpt: "Close magnanimous reindeer before more wow arose plainly or this gull circa before much far and after..."
  },
  {
    title: "This headline could save your life",
    image: `${imageBase}2019/01/nemo-img-7.jpg`,
    category: "Lifestyle",
    date: "Jan 24",
    read: "2 mins read",
    excerpt: "Frail far and far mercifully according up threw much one that unicorn instead one however ecstatic over falcon..."
  }
];

const spotlightSlides = [
  { title: "This headline could save your life", image: `${imageBase}2019/01/nemo-img-7.jpg`, excerpt: stories[7].excerpt },
  { title: "The future of small spaces is surprisingly colorful", image: `${imageBase}2019/01/nemo-img-4.jpg`, excerpt: "A little room can still hold a big idea when every object earns its place and every color gets a chance to speak..." },
  { title: "How to make an ordinary day feel new", image: `${imageBase}2019/01/nemo-img-8.jpg`, excerpt: "Close magnanimous reindeer before more wow arose plainly or this gull circa before much far and after winked..." }
];

const meta = story => `<div class="byline">Ryan Mark <span>in</span> ${story.category}</div><div class="post-meta">${story.date} <i>·</i> ${story.read} <span class="star">★</span></div>`;

function renderArchive() {
document.querySelector(".quick-stories").innerHTML = stories.slice(0, 4).map(story => `
  <article class="quick-story">
    <a class="thumb image-link" href="#recent-posts"><img src="${story.image}" alt="${story.title}" /></a>
    <div><h3><a href="#recent-posts">${story.title}</a></h3>${meta(story)}</div>
  </article>`).join("");

document.querySelector("#editor-list").innerHTML = stories.slice(0, 4).map((story, index) => `
  <article class="editor-item">
    <div class="editor-number">0${index + 1}</div>
    <div><h3><a href="#recent-posts">${story.title}</a></h3>${meta(story)}</div>
  </article>`).join("");

document.querySelector("#highlight-list").innerHTML = stories.slice(0, 4).map(story => `
  <article class="highlight-card">
    <a class="highlight-image image-link" href="#recent-posts"><img src="${story.image}" alt="${story.title}" /></a>
    <div class="highlight-copy"><h3><a href="#recent-posts">${story.title}</a></h3><p>${story.excerpt}</p>${meta(story)}</div>
  </article>`).join("");

document.querySelector("#recent-list").innerHTML = stories.map(story => `
  <article class="recent-item">
    <div class="recent-copy"><span class="eyebrow">Picked by editor</span><h3><a href="#article">${story.title}</a></h3><p>${story.excerpt}</p>${meta(story)}</div>
    <a class="recent-image image-link" href="#article"><img src="${story.image}" alt="${story.title}" /></a>
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
  searchResults.innerHTML = matches.map(story => `<a class="search-result" href="#recent-posts"><strong>${story.title}</strong><small>${story.category} · ${story.date}</small></a>`).join("") || (query ? `<p class="post-meta">No stories found. Try another phrase.</p>` : "");
});
