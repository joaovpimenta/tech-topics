(function (root) {
  "use strict";

  const API_ROOT = "https://api.github.com/repos/joaovpimenta/tech-topics/releases/tags/tts-";
  const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = String(total % 60).padStart(2, "0");
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
  }

  function normalizedChapters(data) {
    if (data?.version !== 1 || !Array.isArray(data.chapters)) return [];
    const chapters = data.chapters
      .filter(item => item && Number.isFinite(item.start) && item.start >= 0)
      .map(item => ({ start: item.start, label: typeof item.label === "string" ? item.label : "" }));
    if (chapters.length < 2 || chapters.some((chapter, i) => i && chapter.start <= chapters[i - 1].start)) return [];
    return chapters;
  }

  function chaptersFromNotes(notes) {
    if (typeof notes !== "string") return [];
    const found = notes.match(/<!-- TECH_TOPICS_CHAPTERS_V1\s*\n([^\n]+)\n-->/);
    if (!found) return [];
    try { return normalizedChapters(JSON.parse(found[1])); }
    catch (_) { return []; }
  }

  async function lookupAudio(slug, fetchImpl = root.fetch) {
    if (!SLUG.test(slug)) throw new Error("Slug de áudio inválida.");
    const response = await fetchImpl(API_ROOT + encodeURIComponent(slug), {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store"
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Consulta à Release indisponível.");
    const release = await response.json();
    const asset = name => release.assets?.some(item => item.name === name && item.state !== "deleted");
    const mp3 = `${slug}.mp3`;
    if (!asset(mp3)) return null;
    const base = `https://github.com/joaovpimenta/tech-topics/releases/download/tts-${slug}/`;
    const chapters = `${slug}.chapters.json`;
    return {
      url: base + mp3,
      chapters: chaptersFromNotes(release.body),
      chaptersUrl: asset(chapters) ? base + chapters : null
    };
  }

  async function findAudio(slug, fetchImpl = root.fetch) {
    return (await lookupAudio(slug, fetchImpl))?.url || null;
  }

  async function loadChapters(url, fetchImpl = root.fetch) {
    const response = await fetchImpl(url, { cache: "no-store" });
    if (!response.ok) return [];
    const data = await response.json();
    return normalizedChapters(data);
  }

  function createPlayer({ document, navigator, article, cover, audio, fetchAudio = lookupAudio, fetchChapters = loadChapters, stopDevice = () => {}, startDevice = () => {} }) {
    const button = document.querySelector("#listen-recording");
    const dock = document.querySelector("#recording-player");
    const title = document.querySelector("#recording-title");
    const subtitle = document.querySelector("#recording-subtitle");
    const image = document.querySelector("#recording-cover");
    const ring = document.querySelector("#recording-ring");
    const playButton = document.querySelector("#recording-play");
    const skip = document.querySelector("#recording-skip");
    const closeButton = document.querySelector("#recording-close");
    const seek = document.querySelector("#recording-seek");
    const elapsed = document.querySelector("#recording-elapsed");
    const duration = document.querySelector("#recording-duration");
    const rate = document.querySelector("#recording-rate");
    const status = document.querySelector("#recording-status");
    const session = navigator.mediaSession;
    let available = false;
    let chapters = [];
    let open = false;
    let seeking = false;

    function setStatus(message) {
      status.textContent = message || "";
    }
    function nextParagraph() {
      const target = chapters.find(chapter => chapter.start > audio.currentTime + 0.7);
      if (target) seekTo(target.start);
    }
    function previousParagraph() {
      const previous = chapters.filter(chapter => chapter.start < audio.currentTime - 2);
      if (previous.length) seekTo(previous[previous.length - 1].start);
      else if (chapters.length) seekTo(chapters[0].start);
    }
    function render() {
      const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      const total = Number.isFinite(audio.duration) ? audio.duration : 0;
      const fraction = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
      if (!seeking) {
        seek.value = String(Math.round(fraction * 1000));
        elapsed.textContent = formatTime(current);
      }
      duration.textContent = total > 0 ? formatTime(total) : "–:––";
      seek.disabled = total <= 0;
      ring.style.setProperty("--recording-progress", `${Math.round(fraction * 360)}deg`);
      const playing = !audio.paused && !audio.ended;
      playButton.setAttribute("aria-label", playing ? "Pausar narração" : "Reproduzir narração");
      playButton.setAttribute("aria-pressed", String(playing));
      playButton.dataset.playing = String(playing);
      button.setAttribute("aria-label", playing ? "Pausar áudio do artigo" : "Ouvir áudio do artigo");
      button.setAttribute("aria-pressed", String(playing));
      button.querySelector(".recording-button-label").textContent = "Ouvir artigo";
      skip.hidden = chapters.length < 2;
      skip.disabled = !chapters.some(chapter => chapter.start > current + 0.7);
      document.body.classList.toggle("recording-open", open);
      dock.hidden = !open;
      if (session) session.playbackState = playing ? "playing" : open ? "paused" : "none";
    }
    function updatePosition() {
      if (!session?.setPositionState || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
      try {
        session.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: Math.max(0, Math.min(audio.currentTime, audio.duration))
        });
      } catch (_) { /* Some browsers expose incomplete Media Session support. */ }
    }
    function seekTo(position) {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      audio.currentTime = Math.min(audio.duration, Math.max(0, position));
      render();
      updatePosition();
    }
    function configureSession() {
      if (!session) return;
      if (typeof root.MediaMetadata === "function") {
        try {
          session.metadata = new root.MediaMetadata({
            title: article.title,
            artist: "Tech Topics · Narração",
            album: "Tech Topics",
            artwork: [{ src: new URL(cover.src, document.baseURI).href }]
          });
        } catch (_) { /* Invalid metadata must never prevent MP3 playback. */ }
      }
      const handlers = {
        play: () => { void play(); },
        pause: () => audio.pause(),
        stop: () => close(),
        seekto: details => seekTo(details.seekTime),
        ...(chapters.length > 1 ? {
          previoustrack: previousParagraph,
          nexttrack: nextParagraph,
          seekbackward: previousParagraph,
          seekforward: nextParagraph
        } : {})
      };
      for (const [action, handler] of Object.entries(handlers)) {
        try { session.setActionHandler(action, handler); }
        catch (_) { /* Unsupported lock-screen action: native playback continues. */ }
      }
      updatePosition();
    }
    function clearSession() {
      if (!session) return;
      for (const action of ["play", "pause", "stop", "seekbackward", "seekforward", "seekto", "previoustrack", "nexttrack"]) {
        try { session.setActionHandler(action, null); } catch (_) {}
      }
      session.playbackState = "none";
      session.metadata = null;
    }
    async function play() {
      if (!available) return;
      stopDevice();
      open = true;
      render();
      configureSession();
      try {
        await audio.play();
        setStatus("");
      } catch (_) {
        setStatus("Não foi possível reproduzir o MP3. Tente novamente ou use a voz do dispositivo.");
        render();
      }
    }
    function close() {
      audio.pause();
      open = false;
      clearSession();
      render();
      setStatus("");
    }
    function stop() {
      close();
    }
    button.addEventListener("click", () => {
      if (!available) return startDevice();
      if (!audio.paused && !audio.ended) audio.pause();
      else void play();
    });
    playButton.addEventListener("click", () => {
      if (!audio.paused && !audio.ended) audio.pause();
      else void play();
    });
    skip.addEventListener("click", nextParagraph);
    closeButton.addEventListener("click", close);
    seek.addEventListener("input", () => {
      seeking = true;
      elapsed.textContent = formatTime(Number(seek.value) / 1000 * (audio.duration || 0));
    });
    seek.addEventListener("change", () => {
      seekTo(Number(seek.value) / 1000 * audio.duration);
      seeking = false;
      render();
    });
    rate.addEventListener("click", () => {
      const speeds = [1, 1.25, 1.5, 1.75, 2];
      audio.playbackRate = speeds[(speeds.indexOf(audio.playbackRate) + 1) % speeds.length];
      rate.textContent = `${audio.playbackRate}×`;
      rate.setAttribute("aria-label", `Velocidade da narração: ${audio.playbackRate} vezes`);
      updatePosition();
    });
    audio.addEventListener("loadedmetadata", () => { render(); updatePosition(); });
    audio.addEventListener("durationchange", () => { render(); updatePosition(); });
    audio.addEventListener("timeupdate", render);
    audio.addEventListener("seeking", render);
    audio.addEventListener("seeked", updatePosition);
    audio.addEventListener("ratechange", updatePosition);
    audio.addEventListener("play", () => { render(); updatePosition(); });
    audio.addEventListener("pause", () => { render(); updatePosition(); });
    audio.addEventListener("ended", () => { render(); updatePosition(); });
    audio.addEventListener("error", () => {
      setStatus("Falha ao carregar o áudio gravado. Use a voz do dispositivo.");
      audio.pause();
      render();
    });
    title.textContent = article.title;
    subtitle.textContent = "Tech Topics · Narração";
    image.src = cover.src;
    image.alt = "";
    audio.preload = "metadata";
    audio.playsInline = true;

    async function discover() {
      try {
        const source = await fetchAudio(article.slug);
        if (!source) return;
        audio.src = typeof source === "string" ? source : source.url;
        available = true;
        if (typeof source === "object") {
          chapters = Array.isArray(source.chapters) ? normalizedChapters({ version: 1, chapters: source.chapters }) : [];
          if (!chapters.length && source.chaptersUrl) {
            try { chapters = await fetchChapters(source.chaptersUrl); }
            catch (_) { chapters = []; }
          }
        }
        render();
      } catch (_) {
        setStatus("Não foi possível verificar se existe áudio gravado.");
      }
    }
    render();
    return { discover, play, stop, close, snapshot: () => ({ available, open, playing: !audio.paused }) };
  }

  const api = { findAudio, lookupAudio, loadChapters, chaptersFromNotes, formatTime, createPlayer };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TechTopicsAudio = api;
})(globalThis);
