import "./index.css"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { useAtomValue } from "@effect/atom-react"
import { akakuFieldsAtom } from "./Manager/atoms"
import { AsyncResult } from "effect/unstable/reactivity"

function App() {
  const fields = useAtomValue(akakuFieldsAtom)

  return (
    <main className="min-h-svh bg-background px-6 py-16 text-foreground">
      <section className="mx-auto flex max-w-3xl flex-col gap-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Tailwind CSS v4 + shadcn/ui</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Website is ready for shadcn components.
          </h1>
          {AsyncResult.builder(fields)
            .onSuccess((fields) => (
              <pre className="whitespace-pre-wrap">{JSON.stringify(fields, null, 2)}</pre>
            ))
            .onErrorTag("NoSuchElementError", () => (
              <p className="text-muted-foreground">No accounts found</p>
            ))
            .orNull()}
        </div>
      </section>
    </main>
  )
}

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
