(() => {
  const installButton = document.querySelector("#install-app");
  const UPDATE_NOTICE_ID = "pwa-update-notice";
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
        .then(registration => {
          let notice;

          const showNotice = () => {
            if (!document.body) return;
            if (document.getElementById(UPDATE_NOTICE_ID)) return;
            if (!notice) {
              notice = document.createElement("aside");
              notice.id = UPDATE_NOTICE_ID;
              notice.setAttribute("role", "status");
              notice.setAttribute("aria-live", "polite");
              notice.style.cssText = "position:fixed;z-index:10000;inset:auto 1rem 1rem 1rem;padding:.75rem 1rem;background:#17212b;color:#fff;border:1px solid #526273;border-radius:.5rem;box-shadow:0 4px 20px #0004";
              const message = document.createElement("span");
              message.textContent = "Uma atualização está pronta. Para aplicá-la sem interromper esta versão, aguarde o fim da leitura ou reprodução, feche todas as abas do Tech Topics e abra o site novamente.";
              notice.append(message);
              document.body.append(notice);
            }
          };

          const observeWaitingWorker = worker => {
            if (!worker) return;
            const updateIfInstalled = () => {
              if (worker.state === "installed" && navigator.serviceWorker.controller) showNotice();
            };
            worker.addEventListener("statechange", updateIfInstalled);
            updateIfInstalled();
          };

          if (registration.waiting) observeWaitingWorker(registration.waiting);
          registration.addEventListener("updatefound", () => observeWaitingWorker(registration.installing));
        })
        .catch(error => console.warn("Modo offline não disponível", error));
    });
  }
})();
