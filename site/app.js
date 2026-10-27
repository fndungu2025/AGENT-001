// Renders the research Markdown files (copied into docs/ at build time) with
// hash routing: #PRD loads docs/PRD.md, #home shows the overview page.
(function () {
  // Each document has its own accent colour (see styles.css [data-doc]) and icon.
  const DOCS = [
    {
      id: "viability-analysis",
      title: "Viability analysis",
      icon: "🔍",
      summary: "Can this be built, who competes with it, and should we proceed?",
      look: "The GO / NO-GO verdict and the fatal-flaw discussion.",
    },
    {
      id: "tech-stack",
      title: "Tech stack",
      icon: "🧱",
      summary: "React, FastAPI, Supabase and Netlify, with costs and integrations.",
      look: "Why Python for ML, and the monthly cost table.",
    },
    {
      id: "PRD",
      title: "Product requirements",
      icon: "📋",
      summary: "The persona, 26 features, database, API and success metrics.",
      look: "Appendix A: the exact analytic definitions and leakage-proof protocol.",
    },
    {
      id: "skills",
      title: "Skills inventory",
      icon: "🛠️",
      summary: "88 reusable Claude Code skills needed to build the product.",
      look: "The summary table and the build waves.",
    },
    {
      id: "agents",
      title: "Agent architecture",
      icon: "🤖",
      summary: "20 AI agents: Meta, Orchestrator, Architect and 17 specialists.",
      look: "The topology diagram and the escalation rules.",
    },
    {
      id: "roadmap",
      title: "Build roadmap",
      icon: "🗺️",
      summary: "MVP scope, six milestones, risks and the launch checklist.",
      look: "The timeline chart and the Sprint Zero checklist.",
    },
    {
      id: "project-memory",
      title: "Project memory",
      icon: "🧠",
      summary: "CLAUDE.md: the context every AI session starts from.",
      look: "Section 3, the current state of the build.",
    },
  ];
  const IDS = DOCS.map((d) => d.id);
  const content = document.getElementById("content");
  const nav = document.getElementById("nav");
  const navList = document.getElementById("nav-list");
  const menu = document.getElementById("menu");
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });

  navList.innerHTML =
    '<li><a href="#home" data-target="home" data-doc="home"><span class="dot" aria-hidden="true">🏠</span>Overview</a></li>' +
    DOCS.map(
      (d) =>
        `<li><a href="#${d.id}" data-target="${d.id}" data-doc="${d.id}">` +
        `<span class="dot" aria-hidden="true">${d.icon}</span>${d.title}</a></li>`,
    ).join("");

  function homeHtml() {
    const cards = DOCS.map(
      (d, i) => `
      <a class="card" href="#${d.id}" data-doc="${d.id}">
        <span class="card-step">${i + 1}</span>
        <span class="card-icon" aria-hidden="true">${d.icon}</span>
        <span class="card-title">${d.title}</span>
        <span class="card-text">${d.summary}</span>
        <span class="card-look"><strong>Look for:</strong> ${d.look}</span>
      </a>`,
    ).join("");
    const milestones = [
      ["M0", "Sprint Zero", "1 week", "done"],
      ["M1", "Data foundation", "1.5 weeks", "next"],
      ["M2", "Analytics core + thin slice", "2 weeks", "planned"],
      ["M3", "Product surface", "2 weeks", "planned"],
      ["M4", "Hardening & pilot readiness", "1 week", "planned"],
      ["M5", "Pilot launch", "launch week", "planned"],
    ]
      .map(
        ([id, name, dur, state]) => `
        <li class="ms ms-${state}">
          <span class="ms-id">${id}</span>
          <span class="ms-name">${name}</span>
          <span class="ms-dur">${dur}</span>
          <span class="pill pill-${state === "done" ? "ok" : state === "next" ? "warn" : "muted"}">${
            state === "done" ? "✅ Done" : state === "next" ? "▶ Next" : "Planned"
          }</span>
        </li>`,
      )
      .join("");
    return `
      <section class="hero">
        <p class="eyebrow">Business analytics project · Research &amp; build documentation</p>
        <h1>CustomerIQ</h1>
        <p class="lead">Predicting customer purchasing behavior and developing data-driven retention strategies in e-commerce.</p>
        <p class="hero-text">An online retailer uploads its order history and gets RFM customer segments, K-means clusters, and a calibrated
        <strong>probability that each customer buys again within 60 days</strong>, with plain-language reasons and an exportable target list.</p>
      </section>

      <h2 class="section-title">At a glance</h2>
      <div class="facts">
        <div class="fact fact-green"><span class="fact-label">Academic project</span><span class="fact-value">GO</span><span class="fact-note">Low technical risk, 6–10 weeks</span></div>
        <div class="fact fact-red"><span class="fact-label">Generic commercial SaaS</span><span class="fact-value">NO-GO</span><span class="fact-note">Klaviyo &amp; Shopify already offer it</span></div>
        <div class="fact fact-blue"><span class="fact-label">Methods</span><span class="fact-value">RFM · K-means · LR · RF</span><span class="fact-note">Out-of-time validation vs. a baseline</span></div>
        <div class="fact fact-violet"><span class="fact-label">Data</span><span class="fact-value">UCI Online Retail II</span><span class="fact-note">1,067,371 transactions, 2009–2011</span></div>
        <div class="fact fact-amber"><span class="fact-label">Stack</span><span class="fact-value">React · FastAPI · Supabase</span><span class="fact-note">Hosted on Netlify &amp; Render</span></div>
        <div class="fact fact-teal"><span class="fact-label">Status</span><span class="fact-value">App live ✅</span><span class="fact-note">Browser analytics app + Sprint Zero built and tested</span></div>
      </div>

      <h2 class="section-title">Start here: the documents in reading order</h2>
      <div class="cards">${cards}</div>

      <h2 class="section-title">Milestones to the MVP pilot (≈ 8 weeks)</h2>
      <ol class="milestones">${milestones}</ol>

      <h2 class="section-title">Colour key used inside the documents</h2>
      <ul class="legend">
        <li><span class="pill pill-ok">GO</span> positive verdict</li>
        <li><span class="pill pill-bad">NO-GO</span> negative verdict</li>
        <li><span class="pill pill-p0">P0</span> MVP-critical</li>
        <li><span class="pill pill-p1">P1</span> important, after MVP</li>
        <li><span class="pill pill-p2">P2</span> nice to have</li>
        <li><span class="pill pill-simple">Simple</span><span class="pill pill-moderate">Moderate</span><span class="pill pill-complex">Complex</span> complexity</li>
      </ul>
      <p class="footnote">Dataset: Chen, D. <em>Online Retail II</em>. UCI Machine Learning Repository, DOI 10.24432/C5CG6D (CC BY 4.0).</p>`;
  }

  // Links between research docs ("./PRD.md", "../.claude/CLAUDE.md") become in-site routes.
  function rewriteLinks(root) {
    root.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      const m = href.match(/(?:^|\/)([\w-]+)\.md(#.*)?$/);
      if (!m || /^https?:/.test(href)) return;
      const name = m[1] === "CLAUDE" ? "project-memory" : m[1];
      if (IDS.includes(name)) a.setAttribute("href", "#" + name);
    });
    root.querySelectorAll('a[href^="http"]').forEach((a) => a.setAttribute("rel", "noopener"));
  }

  // Colour-codes verdicts, priorities and complexity ratings so differences stand out.
  const PILLS = [
    [/\bNO-GO\b/g, "pill-bad"],
    [/(?<![-/\w])GO(?![-\w])/g, "pill-ok"],
    [/\bP0\b/g, "pill-p0"],
    [/\bP1\b/g, "pill-p1"],
    [/\bP2\b/g, "pill-p2"],
  ];
  const RATINGS = { Simple: "pill-simple", Moderate: "pill-moderate", Complex: "pill-complex" };

  function decorate(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || p.closest("pre, code, .mermaid, .pill, a")) return NodeFilter.FILTER_REJECT;
        return /NO-GO|\bGO\b|\bP[012]\b/.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      let html = node.nodeValue.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      PILLS.forEach(([re, cls]) => {
        html = html.replace(re, (m) => `\u0000${cls}\u0001${m}\u0002`);
      });
      html = html.replace(/\u0000([\w-]+)\u0001([^\u0002]*)\u0002/g, '<span class="pill $1">$2</span>');
      const span = document.createElement("span");
      span.innerHTML = html;
      node.replaceWith(...span.childNodes);
    });
    // Table cells that are exactly a complexity rating.
    root.querySelectorAll("td").forEach((td) => {
      const t = td.textContent.trim();
      if (RATINGS[t] && td.children.length === 0) td.innerHTML = `<span class="pill ${RATINGS[t]}">${t}</span>`;
    });
  }

  async function renderMermaid(root) {
    const blocks = root.querySelectorAll("pre > code.language-mermaid");
    blocks.forEach((code) => {
      const div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent;
      code.parentElement.replaceWith(div);
    });
    if (blocks.length) {
      try {
        await mermaid.run({ nodes: root.querySelectorAll(".mermaid") });
      } catch (e) {
        console.warn("Diagram rendering failed", e);
      }
    }
  }

  function setActive(target) {
    document.body.dataset.doc = target;
    navList.querySelectorAll("a").forEach((a) => {
      if (a.dataset.target === target) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    nav.classList.remove("open");
    menu.setAttribute("aria-expanded", "false");
  }

  async function load() {
    const name = decodeURIComponent(location.hash.slice(1));
    if (!name || name === "home" || !IDS.includes(name)) {
      setActive("home");
      content.innerHTML = homeHtml();
      document.title = "CustomerIQ Research";
      window.scrollTo(0, 0);
      return;
    }
    const doc = DOCS.find((d) => d.id === name);
    setActive(doc.id);
    content.innerHTML = '<p class="status">Loading…</p>';
    try {
      const res = await fetch("docs/" + doc.id + ".md");
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      const md = await res.text();
      const banner =
        `<div class="doc-banner"><span class="doc-banner-icon" aria-hidden="true">${doc.icon}</span>` +
        `<div><p class="doc-banner-kicker">Document ${IDS.indexOf(doc.id) + 1} of ${DOCS.length} · ${doc.title}</p>` +
        `<p class="doc-banner-look"><strong>Look for:</strong> ${doc.look}</p></div></div>`;
      content.innerHTML = banner + DOMPurify.sanitize(marked.parse(md));
      content.querySelectorAll("table").forEach((t) => {
        const wrap = document.createElement("div");
        wrap.className = "table-wrap";
        t.replaceWith(wrap);
        wrap.appendChild(t);
      });
      rewriteLinks(content);
      decorate(content);
      await renderMermaid(content);
      const h1 = content.querySelector("h1");
      document.title = (h1 ? h1.textContent : doc.title) + " · CustomerIQ Research";
      window.scrollTo(0, 0);
    } catch (e) {
      content.innerHTML = '<p class="status">Could not load this document (' + e.message + ").</p>";
    }
  }

  menu.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menu.setAttribute("aria-expanded", String(open));
  });
  window.addEventListener("hashchange", load);
  load();
})();
