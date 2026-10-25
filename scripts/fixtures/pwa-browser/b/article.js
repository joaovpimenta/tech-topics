window.__articleVersion = "B";
window.__articleBoots = (window.__articleBoots || 0) + 1;
document.querySelector("#article-version").textContent = `Article JS ${window.__articleVersion}`;
window.loadUnvisitedArticle = async () => (await fetch("content/articles/unvisited.json")).json();
