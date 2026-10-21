// Renders the research Markdown files (copied into docs/ at build time) with
// hash routing: #PRD loads docs/PRD.md.
(function () {
  const DOCS = ["viability-analysis", "tech-stack", "PRD", "skills", "agents", "roadmap", "project-memory"];
  const content = document.getElementById("content");
  const nav = document.getElementById("nav");
  const menu = document.getElementById("menu");
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });

  // Links between research docs ("./PRD.md", "../.claude/CLAUDE.md") become in-site routes.
  function rewriteLinks(root) {
    root.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      const m = href.match(/(?:^|\/)([\w-]+)\.md(#.*)?$/);
      if (!m || /^https?:/.test(href)) return;
      const name = m[1] === "CLAUDE" ? "project-memory" : m[1];
      if (DOCS.includes(name)) a.setAttribute("href", "#" + name);
    });
    root.querySelectorAll('a[href^="http"]').forEach((a) => a.setAttribute("rel", "noopener"));
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
      try { await mermaid.run({ nodes: root.querySelectorAll(".mermaid") }); }
      catch (e) { console.warn("Diagram rendering failed", e); }
    }
  }

  async function load() {
    const name = decodeURIComponent(location.hash.slice(1)) || DOCS[0];
    const doc = DOCS.includes(name) ? name : DOCS[0];
    nav.querySelectorAll("a").forEach((a) => {
      if (a.getAttribute("href") === "#" + doc) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    content.innerHTML = '<p class="status">Loading…</p>';
    try {
      const res = await fetch("docs/" + doc + ".md");
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      const md = await res.text();
      content.innerHTML = DOMPurify.sanitize(marked.parse(md));
      content.querySelectorAll("table").forEach((t) => {
        const wrap = document.createElement("div");
        wrap.className = "table-wrap";
        t.replaceWith(wrap);
        wrap.appendChild(t);
      });
      rewriteLinks(content);
      await renderMermaid(content);
      const h1 = content.querySelector("h1");
      document.title = (h1 ? h1.textContent : doc) + " · CustomerIQ Research";
      window.scrollTo(0, 0);
    } catch (e) {
      content.innerHTML = '<p class="status">Could not load this document (' + e.message + ").</p>";
    }
    nav.classList.remove("open");
    menu.setAttribute("aria-expanded", "false");
  }

  menu.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menu.setAttribute("aria-expanded", String(open));
  });
  window.addEventListener("hashchange", load);
  load();
})();
