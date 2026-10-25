(() => {
  const installButton = document.querySelector("#install-app");
  const UPDATE_NOTICE_ID = "pwa-update-notice";
  const ACTIVE_MEDIA_SELECTOR = "audio, video";
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
          let updateActivated = false;
          let notice;
          let message;
          let button;
          let activationTimeout;

          const isPlaybackActive = () => {
            const mediaPlaying = [...document.querySelectorAll(ACTIVE_MEDIA_SELECTOR)]
              .some(media => !media.paused && !media.ended);
            const synthesis = window.speechSynthesis;
            return mediaPlaying || Boolean(synthesis?.speaking || synthesis?.pending);
          };

          const showNotice = () => {
            if (!document.body) return;
            if (!notice) {
              notice = document.createElement("aside");
              notice.id = UPDATE_NOTICE_ID;
              notice.setAttribute("role", "status");
              notice.setAttribute("aria-live", "polite");
              notice.style.cssText = "position:fixed;z-index:10000;inset:auto 1rem 1rem 1rem;display:flex;gap:.75rem;align-items:center;justify-content:space-between;padding:.75rem 1rem;background:#17212b;color:#fff;border:1px solid #526273;border-radius:.5rem;box-shadow:0 4px 20px #0004";
              message = document.createElement("span");
              button = document.createElement("button");
              button.type = "button";
              button.style.cssText = "min-height:2.75rem;padding:.5rem .8rem;white-space:nowrap";
              button.addEventListener("click", () => {
                if (isPlaybackActive()) {
                  message.textContent = "Atualização disponível. Termine a reprodução e escolha atualizar quando estiver pronto.";
                  return;
                }
                if (!updateActivated && registration.waiting) {
                  button.disabled = true;
                  button.textContent = "Preparando atualização…";
                  registration.waiting.postMessage({ type: "TECH_TOPICS_ACTIVATE_UPDATE" });
                  activationTimeout = setTimeout(() => {
                    if (updateActivated) return;
                    button.disabled = false;
                    button.textContent = "Tentar preparar novamente";
                    message.textContent = "A atualização continua pendente. Você pode continuar usando esta versão.";
                  }, 10000);
                  return;
                }
                // Reload only after an explicit click. The browser restores the
                // current URL (including slug/hash); favorites stay in storage.
                window.location.reload();
              });
              notice.append(message, button);
              document.body.append(notice);
            }
            message.textContent = updateActivated
              ? "A atualização está pronta. Recarregue esta aba quando estiver pronto."
              : "Uma atualização está pronta. Ela não será aplicada durante a reprodução.";
            button.textContent = updateActivated ? "Recarregar para atualizar" : "Preparar atualização";
            button.disabled = false;
            notice.hidden = false;
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
          navigator.serviceWorker.addEventListener("message", event => {
            if (event.data?.type !== "TECH_TOPICS_UPDATE_ACTIVATED") return;
            updateActivated = true;
            clearTimeout(activationTimeout);
            showNotice();
          });
        })
        .catch(error => console.warn("Modo offline não disponível", error));
    });
  }
})();
