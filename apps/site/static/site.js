// provethebuy.com: copy buttons, mobile menu, and the one orchestrated moment (terminal replay).
(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        const before = btn.innerHTML;
        btn.textContent = "Copied";
        setTimeout(() => { btn.innerHTML = before; }, 1400);
      } catch { /* clipboard blocked: leave the text selectable */ }
    });
  });

  const menu = document.querySelector(".menu-btn");
  const nav = document.getElementById("site-nav");
  if (menu && nav) menu.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menu.setAttribute("aria-expanded", String(open));
  });

  // Replay the traffic-check run once when it scrolls into view.
  const term = document.getElementById("term");
  if (!term || reduce || !("IntersectionObserver" in window)) return;
  const finalHTML = term.innerHTML;
  const lines = finalHTML.split("\n");
  const cmdLine = lines[0];
  const cmd = "npx @provethebuy/cli traffic-check access.log";
  term.style.minHeight = term.offsetHeight + "px";
  term.innerHTML = '<span class="p">$</span> <span class="cursor"></span>';

  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    let i = 0;
    const type = () => {
      i++;
      term.innerHTML = `<span class="p">$</span> <span class="w">${cmd.slice(0, i)}</span><span class="cursor"></span>`;
      if (i < cmd.length) setTimeout(type, 28);
      else setTimeout(print, 380);
    };
    let n = 1;
    const print = () => {
      n++;
      term.innerHTML = [cmdLine, ...lines.slice(1, n)].join("\n") + (n < lines.length ? "\n" : "");
      if (n < lines.length) setTimeout(print, 55);
      else term.innerHTML = finalHTML;
    };
    setTimeout(type, 250);
  }, { threshold: 0.4 });
  io.observe(term);
})();
