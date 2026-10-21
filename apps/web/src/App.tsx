export function App() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:outline-2 focus:outline-blue-700"
      >
        Skip to main content
      </a>
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <p className="text-lg font-semibold">CustomerIQ</p>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <h1 className="text-3xl font-bold tracking-tight">CustomerIQ — setup in progress</h1>
        <p className="mt-4 text-base text-slate-700">
          Customer behavior analytics and retention intelligence for online retailers. The app is
          being scaffolded; features will appear here soon.
        </p>
      </main>
      <footer className="border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
        <p>CustomerIQ</p>
      </footer>
    </div>
  );
}
