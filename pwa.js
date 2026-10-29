(() => {
  const installButton = document.querySelector("#install-app");
  const UPDATE_NOTICE_ID = "pwa-update-notice";
  const ACTIVATE_UPDATE_MESSAGE = "TECH_TOPICS_ACTIVATE_UPDATE";
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

  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register((window.TechTopicsSiteBase || "./") + "sw.js", { scope: window.TechTopicsSiteBase || "./", updateViaCache: "none" })
      .then(registration => {
        let notice;
        let updateWorker;
        let activationPending = false;
        let activationRequested = false;
        let activationConfirmed = false;
        let workerActivated = false;
        let reloadScheduled = false;
        let activationTimer;

        const currentTabIsReproducing = () => {
          if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending) return true;
          return [...document.querySelectorAll("audio, video")].some(media => !media.paused && !media.ended);
        };

        const setStatus = text => {
          const status = notice?.querySelector?.("[data-update-status]");
          if (status) status.textContent = text;
        };

        const safelyReloadInitiatingTab = () => {
          if (!activationRequested || !activationConfirmed || !workerActivated || reloadScheduled) return;
          if (currentTabIsReproducing()) {
            activationPending = false;
            const button = notice?.querySelector?.("button");
            if (button) button.disabled = false;
            if (button) button.textContent = "Aplicar atualização";
            setStatus("Quando a leitura ou reprodução terminar, clique em “Aplicar atualização” nesta aba.");
            return;
          }
          reloadScheduled = true;
          window.location.reload();
        };

        const observeActivation = worker => {
          if (!worker || worker !== updateWorker) return;
          if (worker.state === "activated") {
            workerActivated = true;
            if (activationRequested) setStatus("Atualização pronta. Esta aba será recarregada para aplicá-la.");
            safelyReloadInitiatingTab();
          } else if (worker.state === "redundant") {
            activationPending = false;
            clearTimeout(activationTimer);
            const button = notice?.querySelector?.("button");
            if (button) button.disabled = false;
            setStatus("Não foi possível ativar a atualização. Tente novamente mais tarde.");
          }
        };

        const requestUpdate = async () => {
          if (activationPending || reloadScheduled) return;
          if (!window.MessageChannel) {
            setStatus("Não foi possível iniciar a atualização neste navegador.");
            return;
          }
          if (currentTabIsReproducing()) {
            setStatus("Aguarde o fim da leitura ou reprodução nesta aba para atualizar.");
            return;
          }

          if (activationRequested && workerActivated && activationConfirmed) {
            safelyReloadInitiatingTab();
            return;
          }
          if (!registration.waiting && updateWorker?.state === "activated") {
            activationRequested = true;
            activationConfirmed = true;
            workerActivated = true;
            safelyReloadInitiatingTab();
            return;
          }
          if (!registration.waiting) {
            setStatus("A atualização não está mais disponível. Recarregue o site quando puder.");
            return;
          }
          updateWorker = registration.waiting;
          activationRequested = true;
          activationPending = true;
          const button = notice?.querySelector?.("button");
          if (button) button.disabled = true;
          setStatus("Preparando a atualização. As outras abas continuarão abertas e não serão recarregadas.");
          updateWorker.addEventListener("statechange", () => observeActivation(updateWorker));
          const channel = new window.MessageChannel();
          channel.port1.onmessage = event => {
            if (!event.data?.ok) {
              activationPending = false;
              clearTimeout(activationTimer);
              if (button) button.disabled = false;
              setStatus("Não foi possível ativar a atualização. Tente novamente mais tarde.");
              channel.port1.close?.();
              return;
            }
            activationConfirmed = true;
            observeActivation(updateWorker);
          };
          activationTimer = setTimeout(() => {
            if (activationConfirmed || reloadScheduled) return;
            activationPending = false;
            if (button) button.disabled = false;
            setStatus("A ativação demorou mais que o esperado. Você pode tentar novamente.");
            channel.port1.close?.();
          }, 15000);
          try {
            updateWorker.postMessage({ type: ACTIVATE_UPDATE_MESSAGE }, [channel.port2]);
          } catch (error) {
            activationPending = false;
            clearTimeout(activationTimer);
            if (button) button.disabled = false;
            setStatus("Não foi possível iniciar a atualização. Tente novamente mais tarde.");
            channel.port1.close?.();
          }
        };

        const showNotice = worker => {
          if (!document.body || document.getElementById(UPDATE_NOTICE_ID)) return;
          updateWorker = worker;
          notice = document.createElement("aside");
          notice.id = UPDATE_NOTICE_ID;
          notice.setAttribute("role", "status");
          notice.setAttribute("aria-live", "polite");
          notice.style.cssText = "position:fixed;z-index:10000;inset:auto 1rem 1rem 1rem;padding:.75rem 1rem;background:#17212b;color:#fff;border:1px solid #526273;border-radius:.5rem;box-shadow:0 4px 20px #0004;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap";
          const message = document.createElement("span");
          message.textContent = "Uma atualização está pronta. Atualize esta aba quando puder; as outras abas continuarão abertas.";
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "Atualizar agora";
          button.addEventListener("click", requestUpdate);
          const status = document.createElement("span");
          status.setAttribute("data-update-status", "");
          status.setAttribute("aria-live", "polite");
          notice.append(message, button, status);
          document.body.append(notice);
        };

        const observeWaitingWorker = worker => {
          if (!worker) return;
          const updateIfInstalled = () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) showNotice(worker);
          };
          worker.addEventListener("statechange", updateIfInstalled);
          updateIfInstalled();
        };

        if (registration.waiting) observeWaitingWorker(registration.waiting);
        registration.addEventListener("updatefound", () => observeWaitingWorker(registration.installing));
      })
      .catch(error => console.warn("Modo offline não disponível", error));
  });
})();
