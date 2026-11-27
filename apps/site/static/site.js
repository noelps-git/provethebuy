// provethebuy.com – redesigned site interactions
// copy buttons, mobile menu, scroll effects, animated terminals, protocol orbit, etc.
(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ===== COPY BUTTONS ([data-copy] attribute) =====
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

  // ===== MOBILE MENU TOGGLE =====
  const menu = document.querySelector(".menu-btn");
  const siteNav = document.getElementById("site-nav");
  if (menu && siteNav) menu.addEventListener("click", () => {
    const open = siteNav.classList.toggle("open");
    menu.setAttribute("aria-expanded", String(open));
  });

  // ===== SCROLL PROGRESS =====
  const prog = document.getElementById("scrollProgress");
  if (prog) {
    window.addEventListener("scroll", () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      if (h > 0) prog.style.transform = `scaleX(${window.scrollY / h})`;
    }, { passive: true });
  }

  // ===== NAV SCROLL STATE =====
  const topNav = document.getElementById("topNav");
  if (topNav) {
    window.addEventListener("scroll", () => {
      topNav.classList.toggle("scrolled", window.scrollY > 20);
    }, { passive: true });
  }

  // ===== INTERSECTION OBSERVER (reveal animations) =====
  if (!reduce) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("visible"); obs.unobserve(e.target); }
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -40px 0px" });
    document.querySelectorAll(".reveal, .reveal-scale").forEach((el) => obs.observe(el));
  }

  // ===== PARTICLES =====
  if (!reduce) {
    const pc = document.getElementById("particles");
    if (pc) {
      for (let i = 0; i < 40; i++) {
        const p = document.createElement("div");
        p.className = "particle";
        p.style.left = Math.random() * 100 + "%";
        p.style.top = Math.random() * 100 + "%";
        p.style.animationDelay = (Math.random() * 5) + "s";
        p.style.animationDuration = (2 + Math.random() * 4) + "s";
        p.style.width = p.style.height = (1 + Math.random() * 2) + "px";
        pc.appendChild(p);
      }
    }
  }

  // ===== CARD MOUSE GLOW =====
  document.querySelectorAll(".card-glow").forEach((card) => {
    card.addEventListener("mousemove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mouse-x", (e.clientX - r.left) + "px");
      card.style.setProperty("--mouse-y", (e.clientY - r.top) + "px");
    });
  });

  // ===== ANIMATED COUNTERS =====
  if (!reduce) {
    const counterObs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        const target = parseInt(el.dataset.target);
        if (!target) return;
        const dur = 1500;
        const start = performance.now();
        const fmt = new Intl.NumberFormat();
        function tick(now) {
          const p = Math.min((now - start) / dur, 1);
          const ease = 1 - Math.pow(1 - p, 3);
          el.textContent = fmt.format(Math.round(target * ease));
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        counterObs.unobserve(el);
      });
    }, { threshold: 0.5 });
    document.querySelectorAll(".counter").forEach((el) => counterObs.observe(el));
  }

  // ===== TYPING VERIFY LOG =====
  if (!reduce) {
    const lines = [
      { cls: "ok", char: "\u2713", text: " signature   Ed25519 against the Visa key directory" },
      { cls: "ok", char: "\u2713", text: " nonce       first seen, not a replay" },
      { cls: "ok", char: "\u2713", text: " order       cart adds up, addressed to acct_your_shop" },
      { cls: "ok", char: "\u2713", text: " mandate     $184.00 inside the shopper's $250.00 limit" },
      { cls: "to", char: "\u2192", text: " filed       rec_o4Vx8KrZkA0OGlwm, hash-chained" },
    ];
    const logEl = document.getElementById("verifyLog");
    if (logEl) {
      let lineIdx = 0;
      function typeLine() {
        if (lineIdx >= lines.length) return;
        const l = lines[lineIdx];
        const span = document.createElement("span");
        span.innerHTML = `<span class="${l.cls}">${l.char}</span>`;
        logEl.appendChild(span);
        let i = 0;
        function typeChar() {
          if (i < l.text.length) {
            span.innerHTML += l.text[i]; i++;
            setTimeout(typeChar, 8 + Math.random() * 12);
          } else {
            logEl.appendChild(document.createTextNode("\n"));
            lineIdx++;
            setTimeout(typeLine, 200);
          }
        }
        typeChar();
      }
      setTimeout(typeLine, 2500);
    }
  }

  // ===== TILT ON CODE WINDOW =====
  if (!reduce) {
    const cw = document.getElementById("codeWindow");
    if (cw) {
      cw.addEventListener("mousemove", (e) => {
        const r = cw.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        cw.style.transform = `perspective(800px) rotateY(${x * 4}deg) rotateX(${-y * 4}deg) translateY(-4px)`;
      });
      cw.addEventListener("mouseleave", () => { cw.style.transform = ""; });
    }
  }

  // ===== CLI INTERACTIVE TERMINAL =====
  const termOutput = document.getElementById("termOutput");
  if (termOutput) {
    const termTabs = {
      traffic: {
        cmd: "npx @provethebuy/cli traffic-check access.log",
        lines: [
          "",
          { text: "Agent traffic check  access.log", cls: "w" },
          "",
          { text: "  Requests in log          ", cls: "", counter: 1036 },
          { text: "  From AI agents           ", cls: "h", counter: 216 },
          { text: "  On checkout paths        51", cls: "" },
          { text: "  Signed (verifiable)      ", cls: "h", counter: 14 },
          "",
          { text: "  Agent                  Operator     Kind        Requests  Checkout", cls: "w", highlight: false },
          { text: "  ChatGPT-User           OpenAI       user-agent        46        27", cls: "", highlight: true },
          { text: "  GPTBot                 OpenAI       crawler           38         0", cls: "", highlight: true },
          { text: "  ClaudeBot              Anthropic    crawler           27         0", cls: "", highlight: true },
          { text: "  Claude-User            Anthropic    user-agent        19         8", cls: "", highlight: true },
          { text: "  Signed agent           unknown      user-agent        14         7", cls: "", highlight: true },
        ],
        pulseCards: ["infoLocal"]
      },
      verify: {
        cmd: "npx @provethebuy/cli verify --request captured.json",
        lines: [
          "",
          { text: "Verifying request...", cls: "w" },
          "",
          { text: "  \u2713 signature    Ed25519 against Visa key directory", cls: "h" },
          { text: "  \u2713 nonce        first seen, not a replay", cls: "h" },
          { text: "  \u2713 order        cart $184.00, merchant acct_your_shop", cls: "h" },
          { text: "  \u2713 mandate      amount inside $250.00 limit", cls: "h" },
          { text: "  \u2713 expiry       signature valid for 27 more seconds", cls: "h" },
          "",
          { text: "  Result: ALLOWED", cls: "w" },
          { text: "  Record: rec_o4Vx8KrZkA0OGlwm", cls: "" },
        ],
        pulseCards: ["infoCheckout"]
      },
      export: {
        cmd: "npx @provethebuy/cli export --order 48213 --format pdf",
        lines: [
          "",
          { text: "Exporting evidence for order #48213...", cls: "w" },
          "",
          { text: "  Loading record          rec_o4Vx8KrZkA0OGlwm", cls: "" },
          { text: "  Re-verifying proofs     4/4 passed", cls: "h" },
          { text: "  Attaching key snapshot  visa_jwks_2026-10-04.json", cls: "" },
          { text: "  Generating PDF          evidence-48213.pdf", cls: "" },
          "",
          { text: "  \u2713 Exported to ./evidence-48213.pdf (142 KB)", cls: "h" },
          { text: "  \u2713 Stripe-compatible format, ready to submit", cls: "h" },
        ],
        pulseCards: ["infoShare"]
      }
    };

    let currentTab = "traffic";
    let termTyping = false;
    let termAnimated = false;

    function renderTerminal(tabKey, animate) {
      const tab = termTabs[tabKey];
      if (!tab) return;
      termOutput.innerHTML = "";

      if (!animate || reduce) {
        // Render instantly
        let html = `<span class="p">$</span> <span class="w">${tab.cmd}</span>\n`;
        tab.lines.forEach((line) => {
          if (typeof line === "string") { html += "\n"; return; }
          const cls = line.cls ? ` class="${line.cls}"` : "";
          let text = line.text;
          if (line.counter) text += line.counter.toLocaleString();
          html += `<span${cls}>${text}</span>\n`;
        });
        html += `\n<span class="p">$</span> <span class="cursor"></span>`;
        termOutput.innerHTML = html;
        return;
      }

      termTyping = true;
      // Type command first
      const cmdText = `$ ${tab.cmd}`;
      let cmdIdx = 0;
      const promptSpan = document.createElement("span");
      termOutput.appendChild(promptSpan);

      function typeCmd() {
        if (cmdIdx < cmdText.length) {
          if (cmdIdx === 0) {
            promptSpan.innerHTML = `<span class="p">$</span> <span class="w">`;
          } else if (cmdIdx < 2) {
            // skip the "$ " part
          } else {
            const w = promptSpan.querySelector(".w");
            if (w) w.textContent += cmdText[cmdIdx];
          }
          cmdIdx++;
          setTimeout(typeCmd, 15 + Math.random() * 25);
        } else {
          promptSpan.innerHTML += `</span>`;
          termOutput.appendChild(document.createTextNode("\n"));
          typeLines(0);
        }
      }

      function typeLines(idx) {
        if (idx >= tab.lines.length) {
          termOutput.appendChild(document.createTextNode("\n"));
          const finalSpan = document.createElement("span");
          finalSpan.innerHTML = `<span class="p">$</span> <span class="cursor"></span>`;
          termOutput.appendChild(finalSpan);
          termTyping = false;
          // Pulse relevant info cards
          tab.pulseCards.forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
              const wrap = el.querySelector(".icon-wrap");
              if (wrap) { wrap.classList.add("pulse"); setTimeout(() => wrap.classList.remove("pulse"), 600); }
            }
          });
          return;
        }
        const line = tab.lines[idx];
        if (typeof line === "string") {
          termOutput.appendChild(document.createTextNode("\n"));
          setTimeout(() => typeLines(idx + 1), 50);
          return;
        }
        const lineSpan = document.createElement("span");
        if (line.cls) lineSpan.className = line.cls;
        const text = line.text;

        if (line.highlight) {
          lineSpan.classList.add("term-row-highlight");
        }

        if (line.counter) {
          lineSpan.textContent = text;
          termOutput.appendChild(lineSpan);
          // Animate counter
          const target = line.counter;
          const dur = 800;
          const start = performance.now();
          const counterSpan = document.createElement("span");
          counterSpan.className = line.cls || "";
          termOutput.appendChild(counterSpan);
          termOutput.appendChild(document.createTextNode("\n"));
          function countUp(now) {
            const p = Math.min((now - start) / dur, 1);
            const ease = 1 - Math.pow(1 - p, 3);
            counterSpan.textContent = Math.round(target * ease).toLocaleString();
            if (p < 1) requestAnimationFrame(countUp);
          }
          requestAnimationFrame(countUp);
          setTimeout(() => typeLines(idx + 1), 100);
        } else {
          lineSpan.textContent = text;
          termOutput.appendChild(lineSpan);
          termOutput.appendChild(document.createTextNode("\n"));
          setTimeout(() => typeLines(idx + 1), line.highlight ? 150 : 60);
        }
      }

      typeCmd();
    }

    // Terminal scroll trigger
    if (!reduce) {
      const termObs = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !termAnimated) {
            termAnimated = true;
            renderTerminal("traffic", true);
            termObs.unobserve(e.target);
          }
        });
      }, { threshold: 0.3 });
      termObs.observe(termOutput);
    } else {
      renderTerminal("traffic", false);
    }

    // Tab clicks
    document.querySelectorAll(".term-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        if (termTyping) return;
        document.querySelectorAll(".term-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        currentTab = tab.dataset.tab;
        renderTerminal(currentTab, !reduce);
      });
    });
  }

  // ===== HOW IT WORKS — VERTICAL FLOW ANIMATIONS =====
  if (!reduce) {
    const hiwSteps = document.querySelectorAll(".hiw-step");
    if (hiwSteps.length) {
      const hiwObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const step = entry.target;
          if (step.classList.contains("in-view")) return;
          step.classList.add("in-view");
          const idx = step.dataset.hiw;

          if (idx === "0") {
            const lines = step.querySelectorAll(".sig-line");
            lines.forEach((line, i) => {
              setTimeout(() => {
                line.classList.add("show");
                setTimeout(() => { const c = line.querySelector(".sig-check"); if (c) c.classList.add("pass"); }, 300);
              }, i * 400);
            });
            setTimeout(() => { const r = step.querySelector(".sig-result"); if (r) r.classList.add("show"); }, lines.length * 400 + 300);
          } else if (idx === "1") {
            const rows = step.querySelectorAll(".bind-row");
            rows.forEach((row, i) => {
              setTimeout(() => row.classList.add("show"), i * 300);
            });
            setTimeout(() => { const s = step.querySelector(".bind-seal"); if (s) s.classList.add("show"); }, rows.length * 300 + 200);
          } else if (idx === "2") {
            const rows = step.querySelectorAll(".chain-row");
            rows.forEach((row, i) => {
              setTimeout(() => row.classList.add("show"), i * 350);
            });
          }
        });
      }, { threshold: 0.3 });

      hiwSteps.forEach((s) => hiwObserver.observe(s));
    }
  }

  // ===== PROTOCOLS — ORBIT CONSTELLATION =====
  const protoOrbit = document.getElementById("protoOrbit");
  const protoSvg = document.getElementById("protoSvg");
  const protoMobile = document.getElementById("protoMobile");

  if (protoOrbit && protoSvg && protoMobile) {
    const protocols = [
      {
        name: "RFC 9421 HTTP Signatures", status: "stable", statusLabel: "STABLE",
        summary: "Ed25519, RSA-PSS, ECDSA P-256",
        details: "Passes the RFC test vector (B.2.6). Verifies all three algorithm families. Checks nonce, created, expires headers for replay protection.",
        orbit: 180, angle: 270
      },
      {
        name: "Web Bot Auth", status: "stable", statusLabel: "STABLE",
        summary: "Auth tags, key directories",
        details: "Checks agent-browser-auth and agent-payer-auth tags. Validates against published key directories.",
        orbit: 180, angle: 90
      },
      {
        name: "Visa Trusted Agent", status: "beta", statusLabel: "BETA",
        summary: "Visa JWKS, consumer-recognition",
        details: "Verifies signatures against the Visa JSON Web Key Set. Checks consumer-recognition flow and payment-container integrity.",
        orbit: 280, angle: 30
      },
      {
        name: "Mastercard Agent Pay", status: "preview", statusLabel: "PREVIEW",
        summary: "SD-JWT chain, item constraints",
        details: "Validates the selective-disclosure JWT chain. Checks amount limits, merchant allowlist, and item-level constraints.",
        orbit: 280, angle: 210
      },
      {
        name: "AP2 (Agent Payments)", status: "preview", statusLabel: "PREVIEW",
        summary: "Cart mandates, intent mandate",
        details: "Verifies dual-signature cart mandates (merchant + user). Checks intent mandates for delegated purchasing.",
        orbit: 370, angle: 150
      },
      {
        name: "Stripe / ACP", status: "limits", statusLabel: "LIMITS ONLY",
        summary: "Amount, currency, merchant limits",
        details: "Checks Stripe token allowance parameters: maximum amount, currency restriction, merchant scope, and expiry time.",
        orbit: 370, angle: 330
      }
    ];

    const statusColors = { stable: "#4ADE80", beta: "#818CF8", preview: "#A78BFA", limits: "#71717A" };
    const cx = 480, cy = 410;
    const svgW = 960, svgH = 820;
    const nodeW = 150, nodeH = 50;

    protocols.forEach((proto, idx) => {
      const rad = proto.angle * Math.PI / 180;
      const nx = cx + proto.orbit * Math.cos(rad);
      const ny = cy + proto.orbit * Math.sin(rad);
      const color = statusColors[proto.status];

      // SVG connection line
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", cx); line.setAttribute("y1", cy);
      line.setAttribute("x2", nx); line.setAttribute("y2", ny);
      line.classList.add("conn-line");
      line.style.stroke = color;
      line.style.opacity = "0.2";
      line.style.animationDelay = (idx * 0.3) + "s";
      protoSvg.appendChild(line);

      // DOM node card
      const node = document.createElement("div");
      node.className = "proto-node";
      node.style.left = `calc(${(nx / svgW) * 100}% - ${nodeW / 2}px)`;
      node.style.top = `calc(${(ny / svgH) * 100}% - ${nodeH / 2}px)`;
      node.innerHTML = `
        <div class="proto-node-name">${proto.name}</div>
        <span class="proto-node-badge ${proto.status}">${proto.statusLabel}</span>
        <div class="proto-node-summary">${proto.summary}</div>
        <div class="proto-node-details"><p>${proto.details}</p></div>`;
      node.dataset.idx = idx;
      protoOrbit.appendChild(node);

      // Mobile card
      const mCard = document.createElement("div");
      mCard.className = "proto-mobile-card";
      mCard.innerHTML = `
        <div class="proto-node-name">${proto.name}</div>
        <span class="proto-node-badge ${proto.status}" style="margin-bottom:8px">${proto.statusLabel}</span>
        <div class="proto-node-details"><p>${proto.details}</p></div>`;
      protoMobile.appendChild(mCard);
    });

    // Scroll-triggered fly-in
    const protocolsSection = document.getElementById("protocolsSection");
    if (protocolsSection) {
      if (!reduce) {
        const protoObserver = new IntersectionObserver((entries) => {
          entries.forEach((e) => {
            if (!e.isIntersecting) return;
            protoOrbit.querySelectorAll(".proto-node").forEach((n, i) => {
              setTimeout(() => n.classList.add("in-orbit"), i * 180);
            });
            protoMobile.querySelectorAll(".proto-mobile-card").forEach((c, i) => {
              setTimeout(() => c.classList.add("visible"), i * 150);
            });
            protoObserver.unobserve(e.target);
          });
        }, { threshold: 0.15 });
        protoObserver.observe(protocolsSection);
      } else {
        // Show everything immediately if reduced motion
        protoOrbit.querySelectorAll(".proto-node").forEach((n) => n.classList.add("in-orbit"));
        protoMobile.querySelectorAll(".proto-mobile-card").forEach((c) => c.classList.add("visible"));
      }
    }
  }

  // ===== RUN LOCALLY — ENHANCED TERMINAL =====
  const runTerminal = document.getElementById("runTerminal");
  if (runTerminal) {
    const runCommands = [
      { prompt: "$ ", cmd: "git clone", args: " https://github.com/noelps-git/provethebuy.git", output: "Cloning into 'provethebuy'... done." },
      { prompt: "$ ", cmd: "cd", args: " provethebuy", output: null },
      { prompt: "$ ", cmd: "npm install", args: "", output: "added 12 packages in 2.1s" },
      { prompt: "$ ", cmd: "npm run", args: " demo", output: null }
    ];
    let runAnimated = false;

    function animateRunTerminal() {
      if (runAnimated) return;
      runAnimated = true;
      runTerminal.innerHTML = "";

      if (reduce) {
        // Show final state immediately
        let html = "";
        runCommands.forEach((c) => {
          html += `<span class="p">$</span> <span class="rl-cmd">${c.cmd}</span>`;
          if (c.args) html += `<span class="rl-path">${c.args}</span>`;
          html += "\n";
          if (c.output) html += `<span class="rl-output visible">${c.output}</span>\n`;
        });
        html += "\n";
        html += `<span class="rl-output visible">\u2713 Server running at http://localhost:4319</span>\n`;
        html += `<span class="rl-output visible">\u2713 Dashboard ready — open your browser</span>\n`;
        html += `<span class="p">$</span> <span class="rl-cursor"></span>`;
        runTerminal.innerHTML = html;
        return;
      }

      function typeCommand(idx) {
        if (idx >= runCommands.length) {
          setTimeout(() => {
            runTerminal.appendChild(document.createTextNode("\n"));
            const serverMsg = document.createElement("span");
            serverMsg.className = "rl-output";
            serverMsg.textContent = "\u2713 Server running at http://localhost:4319";
            runTerminal.appendChild(serverMsg);
            runTerminal.appendChild(document.createTextNode("\n"));
            const readyMsg = document.createElement("span");
            readyMsg.className = "rl-output";
            readyMsg.textContent = "\u2713 Dashboard ready — open your browser";
            runTerminal.appendChild(readyMsg);
            setTimeout(() => serverMsg.classList.add("visible"), 200);
            setTimeout(() => readyMsg.classList.add("visible"), 600);
            setTimeout(() => {
              runTerminal.appendChild(document.createTextNode("\n"));
              const cursor = document.createElement("span");
              cursor.innerHTML = '<span class="p">$</span> <span class="rl-cursor"></span>';
              runTerminal.appendChild(cursor);
            }, 1000);
          }, 400);
          return;
        }
        const c = runCommands[idx];
        const lineSpan = document.createElement("span");
        runTerminal.appendChild(lineSpan);
        const fullText = c.prompt + c.cmd + c.args;
        let charIdx = 0;

        function typeChar() {
          if (charIdx < fullText.length) {
            if (charIdx === 0) {
              lineSpan.innerHTML = '<span class="p">$</span> ';
              charIdx = 2;
            } else if (charIdx < 2 + c.cmd.length) {
              if (charIdx === 2) {
                const cmdSpan = document.createElement("span");
                cmdSpan.className = "rl-cmd";
                lineSpan.appendChild(cmdSpan);
              }
              const el = lineSpan.querySelector(".rl-cmd");
              if (el) el.textContent += fullText[charIdx];
              charIdx++;
            } else {
              if (charIdx === 2 + c.cmd.length && c.args.length > 0) {
                const argsSpan = document.createElement("span");
                argsSpan.className = "rl-path";
                lineSpan.appendChild(argsSpan);
              }
              const argEl = lineSpan.querySelector(".rl-path");
              if (argEl) argEl.textContent += fullText[charIdx];
              else lineSpan.appendChild(document.createTextNode(fullText[charIdx]));
              charIdx++;
            }
            setTimeout(typeChar, 12 + Math.random() * 18);
          } else {
            runTerminal.appendChild(document.createTextNode("\n"));
            if (c.output) {
              const outSpan = document.createElement("span");
              outSpan.className = "rl-output";
              outSpan.textContent = c.output;
              runTerminal.appendChild(outSpan);
              runTerminal.appendChild(document.createTextNode("\n"));
              setTimeout(() => outSpan.classList.add("visible"), 100);
              setTimeout(() => typeCommand(idx + 1), 500);
            } else {
              setTimeout(() => typeCommand(idx + 1), 300);
            }
          }
        }
        typeChar();
      }
      typeCommand(0);
    }

    if (!reduce) {
      const runObs = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            animateRunTerminal();
            runObs.unobserve(e.target);
          }
        });
      }, { threshold: 0.2 });
      runObs.observe(runTerminal);
    } else {
      animateRunTerminal();
    }
  }

  // ===== FEATURE PILLS STAGGERED ANIMATION =====
  if (!reduce) {
    const featurePills = document.getElementById("featurePills");
    if (featurePills) {
      const pillObs = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const pills = document.querySelectorAll(".feature-pill");
            pills.forEach((pill, i) => {
              setTimeout(() => pill.classList.add("visible"), i * 200);
            });
            pillObs.unobserve(e.target);
          }
        });
      }, { threshold: 0.3 });
      pillObs.observe(featurePills);
    }
  }

  // ===== NETWORK BACKGROUND DOTS =====
  if (!reduce) {
    const rlNetworkBg = document.getElementById("rlNetworkBg");
    if (rlNetworkBg) {
      const dots = [];
      for (let i = 0; i < 30; i++) {
        const d = document.createElement("div");
        d.className = "rl-network-dot";
        d.style.left = Math.random() * 100 + "%";
        d.style.top = Math.random() * 100 + "%";
        d.style.animationDelay = (Math.random() * 4) + "s";
        d.style.animationDuration = (3 + Math.random() * 3) + "s";
        rlNetworkBg.appendChild(d);
        dots.push({ el: d, x: parseFloat(d.style.left), y: parseFloat(d.style.top) });
      }
      // Connect nearby dots with lines
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x;
          const dy = dots[i].y - dots[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 25) {
            const line = document.createElement("div");
            line.className = "rl-network-line";
            line.style.left = dots[i].x + "%";
            line.style.top = dots[i].y + "%";
            line.style.width = dist + "%";
            const angle = Math.atan2(dots[j].y - dots[i].y, dots[j].x - dots[i].x) * 180 / Math.PI;
            line.style.transform = `rotate(${angle}deg)`;
            rlNetworkBg.appendChild(line);
          }
        }
      }
    }
  }

  // ===== PARTICLE TRAILS ON MOUSE =====
  if (!reduce) {
    const rlParticleCanvas = document.getElementById("rlParticleCanvas");
    const runLocallySection = document.getElementById("runLocally");
    if (rlParticleCanvas && runLocallySection) {
      const ctx = rlParticleCanvas.getContext("2d");
      let particles = [];
      let mouseX = -100, mouseY = -100;

      function resize() {
        const rect = runLocallySection.getBoundingClientRect();
        rlParticleCanvas.width = rect.width;
        rlParticleCanvas.height = rect.height;
      }
      resize();
      window.addEventListener("resize", resize);

      runLocallySection.addEventListener("mousemove", (e) => {
        const rect = runLocallySection.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        mouseY = e.clientY - rect.top;
        for (let i = 0; i < 2; i++) {
          particles.push({
            x: mouseX, y: mouseY,
            vx: (Math.random() - 0.5) * 1.5,
            vy: (Math.random() - 0.5) * 1.5,
            life: 1,
            size: 1 + Math.random() * 2,
            color: Math.random() > 0.5 ? "99,102,241" : "34,211,238"
          });
        }
      });

      function animate() {
        ctx.clearRect(0, 0, rlParticleCanvas.width, rlParticleCanvas.height);
        particles = particles.filter((p) => p.life > 0);
        particles.forEach((p) => {
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 0.02;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${p.color},${p.life * 0.6})`;
          ctx.fill();
        });
        requestAnimationFrame(animate);
      }
      animate();
    }
  }

  // ===== CLOUD — CINEMATIC SPLIT ANIMATION =====
  const cloudSection = document.getElementById("cloudSection");
  if (cloudSection) {
    const cloudObs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;

        if (reduce) {
          // Show everything immediately
          document.querySelectorAll(".cloud-frame").forEach((f) => f.classList.add("visible"));
          const evWrap = document.getElementById("cloudEvidence");
          if (evWrap) evWrap.classList.add("visible");
          document.querySelectorAll("#evProofs .ev-proof").forEach((p) => p.classList.add("show"));
          const footer = document.getElementById("evFooter");
          if (footer) footer.classList.add("show");
          cloudObs.unobserve(e.target);
          return;
        }

        // Animate left film frames sequentially
        const frames = document.querySelectorAll(".cloud-frame");
        frames.forEach((frame, i) => {
          setTimeout(() => frame.classList.add("visible"), i * 500);
        });

        // After frames done, build right evidence card
        const totalFrameTime = frames.length * 500 + 300;
        setTimeout(() => {
          const evWrap = document.getElementById("cloudEvidence");
          if (evWrap) evWrap.classList.add("visible");

          // Stagger proofs
          const proofs = document.querySelectorAll("#evProofs .ev-proof");
          proofs.forEach((proof, i) => {
            setTimeout(() => proof.classList.add("show"), i * 350);
          });

          // Footer and counter
          setTimeout(() => {
            const footer = document.getElementById("evFooter");
            if (footer) footer.classList.add("show");

            // Animate recovered amount counter
            const amtEl = document.getElementById("evRecoveredAmt");
            if (amtEl) {
              const target = 184;
              const dur = 1200;
              const start = performance.now();
              function countUp(now) {
                const p = Math.min((now - start) / dur, 1);
                const ease = 1 - Math.pow(1 - p, 3);
                const val = (target * ease).toFixed(2);
                amtEl.textContent = "$" + val;
                if (p < 1) requestAnimationFrame(countUp);
              }
              requestAnimationFrame(countUp);
            }
          }, proofs.length * 350 + 200);
        }, totalFrameTime);

        // Confetti particles
        setTimeout(() => {
          const confettiEl = document.getElementById("cfaConfetti");
          if (confettiEl) {
            const colors = ["var(--green)", "var(--cyan)", "var(--accent)", "var(--purple)", "var(--orange)"];
            for (let i = 0; i < 12; i++) {
              const piece = document.createElement("div");
              piece.className = "cfa-confetti-piece";
              piece.style.left = (10 + Math.random() * 80) + "%";
              piece.style.background = colors[i % colors.length];
              piece.style.animationDelay = (Math.random() * 0.5) + "s";
              piece.style.animationDuration = (0.8 + Math.random() * 0.4) + "s";
              confettiEl.appendChild(piece);
            }
          }
        }, 3 * 500);

        cloudObs.unobserve(e.target);
      });
    }, { threshold: 0.15 });
    cloudObs.observe(cloudSection);
  }

  // ===== GLASS CARD TILT (sub-pages) =====
  if (!reduce) {
    document.querySelectorAll(".glass.card-glow").forEach((card) => {
      card.addEventListener("mousemove", (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = `perspective(800px) rotateY(${x * 2}deg) rotateX(${-y * 2}deg) translateY(-4px)`;
      });
      card.addEventListener("mouseleave", () => {
        card.style.transform = "";
      });
    });
  }

  // ===== STAGGERED LIST ITEMS =====
  if (!reduce) {
    const staggerObs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const items = e.target.querySelectorAll("li");
        items.forEach((li, i) => {
          li.style.opacity = "0";
          li.style.transform = "translateX(-12px)";
          li.style.transition = `opacity 0.4s ${i * 0.08}s var(--ease-out), transform 0.4s ${i * 0.08}s var(--ease-out)`;
          requestAnimationFrame(() => {
            li.style.opacity = "1";
            li.style.transform = "translateX(0)";
          });
        });
        staggerObs.unobserve(e.target);
      });
    }, { threshold: 0.2 });
    document.querySelectorAll(".compare-list, .steps, .threat-reasons").forEach((el) => staggerObs.observe(el));
  }

  // ===== TABLE ROW STAGGER =====
  if (!reduce) {
    const tableObs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const rows = e.target.querySelectorAll("tbody tr");
        rows.forEach((row, i) => {
          setTimeout(() => row.classList.add("show"), i * 60);
        });
        tableObs.unobserve(e.target);
      });
    }, { threshold: 0.1 });
    document.querySelectorAll(".table-stagger").forEach((el) => tableObs.observe(el));
  }

  // ===== COMPARISON SLIDER =====
  document.querySelectorAll(".compare-slider").forEach((slider) => {
    const handle = slider.querySelector(".compare-slider-handle");
    const left = slider.querySelector(".compare-slider-side.left");
    if (!handle || !left) return;

    // Add hint element
    const hint = document.createElement("div");
    hint.className = "compare-slider-hint";
    hint.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8h12M5 5l-3 3 3 3M11 5l3 3-3 3"/></svg> Drag to compare';
    slider.appendChild(hint);

    let dragging = false;
    let interacted = false;

    function updateSlider(x) {
      const rect = slider.getBoundingClientRect();
      let pct = ((x - rect.left) / rect.width) * 100;
      pct = Math.max(2, Math.min(98, pct));
      left.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
      handle.style.left = `calc(${pct}% - 20px)`;
      if (!interacted) { interacted = true; hint.classList.add("hidden"); }
    }

    // Mouse events
    handle.addEventListener("mousedown", (e) => { dragging = true; e.preventDefault(); });
    window.addEventListener("mousemove", (e) => { if (dragging) updateSlider(e.clientX); });
    window.addEventListener("mouseup", () => { dragging = false; });

    // Touch: swipe anywhere on the slider
    slider.addEventListener("touchstart", (e) => { dragging = true; updateSlider(e.touches[0].clientX); }, { passive: true });
    slider.addEventListener("touchmove", (e) => { if (dragging) { e.preventDefault(); updateSlider(e.touches[0].clientX); } }, { passive: false });
    slider.addEventListener("touchend", () => { dragging = false; });
  });

  // ===== PIPELINE FLOW ANIMATION =====
  if (!reduce) {
    const pipelineEl = document.getElementById("pipelineFlow");
    if (pipelineEl) {
      const pipeObs = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const nodes = pipelineEl.querySelectorAll(".pipeline-node");
          const connectors = pipelineEl.querySelectorAll(".pipeline-connector");
          nodes.forEach((node, i) => {
            setTimeout(() => {
              node.classList.add("active");
              if (connectors[i]) {
                setTimeout(() => connectors[i].classList.add("filled"), 200);
              }
            }, i * 500);
          });
          pipeObs.unobserve(e.target);
        });
      }, { threshold: 0.3 });
      pipeObs.observe(pipelineEl);
    }
  }

  // ===== THREAT SCORE DEMO =====
  const threatDemo = document.getElementById("threatDemo");
  if (threatDemo) {
    const logEl = threatDemo.querySelector(".threat-demo-log");
    const scoreNum = threatDemo.querySelector(".threat-score-num");
    const scoreFill = threatDemo.querySelector(".threat-score-fill");
    const signals = threatDemo.querySelectorAll(".threat-signal-pill");
    const replayBtn = threatDemo.querySelector(".threat-demo-replay");

    const demoRequests = [
      { text: "GET /robots.txt", cls: "req-warn", signal: 0, score: 5 },
      { text: "GET /sitemap.xml", cls: "req-warn", signal: 0, score: 10 },
      { text: "GET /.well-known/openapi.json", cls: "req-warn", signal: 0, score: 18 },
      { text: "POST /api/auth/login  → 401", cls: "req-bad", signal: 1, score: 28 },
      { text: "POST /api/auth/login  → 401", cls: "req-bad", signal: 1, score: 36 },
      { text: "POST /api/auth/login  → 429", cls: "req-bad", signal: 1, score: 45 },
      { text: "— 3.2s pause —", cls: "req-ok", signal: 2, score: 52 },
      { text: "POST /api/auth/reset  → 200", cls: "req-warn", signal: 1, score: 58 },
      { text: "— 2.8s pause —", cls: "req-ok", signal: 2, score: 62 },
      { text: "GET /checkout (browser UA)", cls: "req-bad", signal: 3, score: 70 },
      { text: "POST /api/checkout/complete", cls: "req-bad", signal: 3, score: 78 },
    ];

    function runDemo() {
      if (!logEl || !scoreNum || !scoreFill) return;
      logEl.innerHTML = "";
      scoreNum.textContent = "0";
      scoreNum.className = "threat-score-num";
      scoreFill.style.width = "0%";
      scoreFill.className = "threat-score-fill";
      signals.forEach((s) => s.classList.remove("fired"));

      demoRequests.forEach((req, i) => {
        setTimeout(() => {
          const line = document.createElement("div");
          line.className = "req-line " + req.cls;
          line.textContent = req.text;
          logEl.appendChild(line);
          requestAnimationFrame(() => line.classList.add("show"));
          logEl.scrollTop = logEl.scrollHeight;

          // Update score
          scoreNum.textContent = req.score;
          scoreFill.style.width = req.score + "%";
          if (req.score >= 60) {
            scoreNum.className = "threat-score-num danger";
            scoreFill.className = "threat-score-fill danger";
          } else if (req.score >= 35) {
            scoreNum.className = "threat-score-num warn";
            scoreFill.className = "threat-score-fill warn";
          }

          // Fire signal pill
          if (signals[req.signal]) signals[req.signal].classList.add("fired");
        }, i * 600);
      });
    }

    if (!reduce) {
      const demoObs = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          runDemo();
          demoObs.unobserve(e.target);
        });
      }, { threshold: 0.3 });
      demoObs.observe(threatDemo);
    } else {
      // Show final state
      if (logEl) {
        demoRequests.forEach((req) => {
          const line = document.createElement("div");
          line.className = "req-line show " + req.cls;
          line.textContent = req.text;
          logEl.appendChild(line);
        });
      }
      if (scoreNum) scoreNum.textContent = "78";
      if (scoreFill) { scoreFill.style.width = "78%"; scoreFill.className = "threat-score-fill danger"; }
      signals.forEach((s) => s.classList.add("fired"));
    }

    if (replayBtn) replayBtn.addEventListener("click", runDemo);
  }

  // ===== PRICING TOGGLE =====
  const pricingToggle = document.getElementById("pricingToggle");
  if (pricingToggle) {
    const monthlyLabel = pricingToggle.previousElementSibling;
    const annualLabel = pricingToggle.nextElementSibling;
    const saveBadge = document.querySelector(".save-badge");
    const priceEls = document.querySelectorAll(".plan .price");
    const monthlyPrices = { "Indie": 9, "Pro": 49, "Scale": 199 };
    const annualPrices = { "Indie": 90, "Pro": 490, "Scale": 1990 };
    let isAnnual = false;

    pricingToggle.addEventListener("click", () => {
      isAnnual = !isAnnual;
      pricingToggle.classList.toggle("annual", isAnnual);
      if (monthlyLabel) monthlyLabel.classList.toggle("active", !isAnnual);
      if (annualLabel) annualLabel.classList.toggle("active", isAnnual);
      if (saveBadge) saveBadge.classList.toggle("show", isAnnual);

      priceEls.forEach((el) => {
        const planName = el.closest(".plan").querySelector("h3");
        if (!planName) return;
        const name = planName.textContent.trim();
        const prices = isAnnual ? annualPrices : monthlyPrices;
        const target = prices[name];
        if (target === undefined) return;
        const small = el.querySelector("small");
        if (!small && target === 0) return;

        // Animate the number
        const current = parseInt(el.textContent.replace(/[^0-9]/g, "")) || 0;
        const dur = 400;
        const start = performance.now();
        function tick(now) {
          const p = Math.min((now - start) / dur, 1);
          const ease = 1 - Math.pow(1 - p, 3);
          const val = Math.round(current + (target - current) * ease);
          el.innerHTML = `$${val} <small>/ ${isAnnual ? "year" : "month"}</small>`;
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    });
  }

  // ===== FAIL-OPEN FLOW DIAGRAM (security) =====
  if (!reduce) {
    const flowDiagram = document.getElementById("flowDiagram");
    if (flowDiagram) {
      const flowObs = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const nodes = flowDiagram.querySelectorAll(".flow-node");
          const paths = flowDiagram.querySelectorAll(".flow-path");
          nodes.forEach((n, i) => setTimeout(() => n.classList.add("show"), i * 300));
          paths.forEach((p, i) => setTimeout(() => p.classList.add("show"), 200 + i * 300));
          flowObs.unobserve(e.target);
        });
      }, { threshold: 0.3 });
      flowObs.observe(flowDiagram);
    }
  }

  // ===== DATA FLOW ANIMATION (security) =====
  if (!reduce) {
    const dataFlow = document.getElementById("dataFlow");
    if (dataFlow) {
      const dfObs = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const fields = dataFlow.querySelectorAll(".data-flow-field");
          fields.forEach((f, i) => {
            setTimeout(() => {
              f.classList.add("show");
              const status = f.querySelector(".field-status");
              if (status) setTimeout(() => status.classList.add("show"), 300);
            }, i * 200);
          });
          dfObs.unobserve(e.target);
        });
      }, { threshold: 0.3 });
      dfObs.observe(dataFlow);
    }
  }

  // ===== HASH CHAIN ANIMATION (security) =====
  if (!reduce) {
    const securityChain = document.getElementById("securityChain");
    if (securityChain) {
      const chainObs = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const rows = securityChain.querySelectorAll(".chain-row");
          rows.forEach((row, i) => setTimeout(() => row.classList.add("show"), i * 350));
          chainObs.unobserve(e.target);
        });
      }, { threshold: 0.3 });
      chainObs.observe(securityChain);
    }
  }

  // ===== MINI CONSTELLATION (agent-identity protocols) =====
  if (!reduce) {
    const miniConst = document.getElementById("miniConstellation");
    if (miniConst) {
      const mcObs = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          miniConst.querySelectorAll(".mc-node").forEach((n, i) => {
            setTimeout(() => n.classList.add("show"), i * 200);
          });
          mcObs.unobserve(e.target);
        });
      }, { threshold: 0.2 });
      mcObs.observe(miniConst);
    }
  }

  // ===== SIGNAL CARD HOVER ANIMATIONS =====
  document.querySelectorAll(".signal-card[data-signal]").forEach((card) => {
    const type = card.dataset.signal;
    const anim = document.createElement("div");
    anim.className = "signal-anim";
    if (type === "timing") {
      anim.innerHTML = '<div class="signal-anim-bars">' +
        [30, 70, 20, 80, 40, 60, 25].map((h, i) =>
          `<div class="bar" style="height:${h}%;animation-delay:${i * 0.15}s"></div>`
        ).join("") + '</div>';
    } else {
      anim.innerHTML = '<div class="pulse-ring"></div><div class="dot" style="top:50%;left:50%;transform:translate(-50%,-50%)"></div>';
    }
    card.appendChild(anim);
  });

})();
