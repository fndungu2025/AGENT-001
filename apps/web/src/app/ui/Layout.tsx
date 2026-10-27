import type { ReactNode, MouseEvent } from "react";
import { COPY, DOCS_URL } from "../copy";

export function Header({ view, analyticsHref }: { view: "analytics" | "how"; analyticsHref: string }) {
  return (
    <header className="header">
      <div className="container header-inner">
        <a className="brand" href={analyticsHref}>
          <span className="logo" aria-hidden="true">
            IQ
          </span>
          {COPY.appName}
        </a>
        <nav className="nav" aria-label={COPY.nav.main}>
          <a href={analyticsHref} aria-current={view === "analytics" ? "page" : undefined}>
            {COPY.nav.analytics}
          </a>
          <a href="#how" aria-current={view === "how" ? "page" : undefined}>
            {COPY.nav.how}
          </a>
          <a href={DOCS_URL}>{COPY.nav.docs}</a>
        </nav>
      </div>
    </header>
  );
}

export function Footer({ showUci }: { showUci: boolean }) {
  return (
    <footer className="footer">
      <div className="container">
        <p>🔒 {COPY.footer.privacy}</p>
        {showUci ? <p>{COPY.footer.uci}</p> : null}
      </div>
    </footer>
  );
}

export function SkipLink() {
  const go = (e: MouseEvent) => {
    e.preventDefault();
    document.getElementById("main")?.focus();
  };
  return (
    <a href="#main" className="skip-link" onClick={go}>
      {COPY.skip}
    </a>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="main" tabIndex={-1}>
      {children}
    </main>
  );
}
