(() => {
  const installButton = document.querySelector("#install-app");
  let installPrompt;
  window.addEventListener("beforeinstallprompt", event => {
    if (!installButton) return;
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });
  installButton?.addEventListener("click", async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    installButton.hidden = true;
    try { await prompt.prompt(); } catch (error) { console.warn("Instalação não disponível", error); }
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    if (installButton) installButton.hidden = true;
  });
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" })
        .catch(error => console.warn("Modo offline não disponível", error));
    });
  }
})();
