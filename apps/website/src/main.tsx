import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

function App() {
  return (
    <main className="min-h-svh bg-background px-6 py-16 text-foreground">
      <section className="mx-auto flex max-w-3xl flex-col gap-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Tailwind CSS v4 + shadcn/ui</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Website is ready for shadcn components.
          </h1>
        </div>
        <p className="text-muted-foreground">
          Tailwind v4 is wired through Vite, shadcn theme tokens are available, and component
          aliases resolve from <code>@/</code>.
        </p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
