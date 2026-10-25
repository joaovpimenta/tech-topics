window.__appVersion = "A";
window.__appBoots = (window.__appBoots || 0) + 1;
document.querySelector("#app-version").textContent = `App ${window.__appVersion}`;
window.loadUnvisitedArticle = async () => (await fetch("content/articles/unvisited.json")).json();
