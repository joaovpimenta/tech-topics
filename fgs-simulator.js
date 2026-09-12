(() => {
  function initFgsSimulator() {
    const root = document.querySelector("#fgs-simulator");
    if (!root || root.dataset.initialized) return;
    root.dataset.initialized = "true";
    const input = root.querySelector("#fgs-arrival");
    const number = value => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
    function render() {
      const arrival = Number(input.value);
      const capacity = 100;
      const duration = 1 / (capacity - arrival);
      root.querySelector("#fgs-traffic").textContent = `${number(arrival)} operações/s`;
      root.querySelector("#fgs-utilization").textContent = `${number(100 * arrival / capacity)}%`;
      root.querySelector("#fgs-duration").textContent = `${number(1000 * duration)} ms`;
      root.querySelector("#fgs-concurrency").textContent = number(arrival * duration);
    }
    input.addEventListener("input", render);
    render();
  }
  document.addEventListener("tech-topics:article-ready", initFgsSimulator);
  initFgsSimulator();
})();
