import "./index.css"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { useAtom } from "@effect/atom-react"
import { akakuFieldsAtom } from "./Manager/atoms"
import { AsyncResult } from "effect/unstable/reactivity"
import { Input } from "./components/ui/input"
import { Button } from "./components/ui/button"
import { Option, Schema } from "effect"
import { AkahuCustomFields } from "@app/domain/Manager/AkahuCustomFields"

function App() {
  const [fields, setFields] = useAtom(akakuFieldsAtom)

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
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const formData = new FormData(e.target as HTMLFormElement)
                  const akahuAppToken = formData.get("akahuAppToken")
                  const akahuUserToken = formData.get("akahuUserToken")
                  const fields = Schema.decodeUnknownOption(AkahuCustomFields)({
                    akahuAppToken,
                    akahuUserToken,
                  })
                  if (Option.isNone(fields)) return
                  setFields(fields.value)
                }}
              >
                <Input type="password" name="akahuAppToken" />
                <Input type="password" name="akahuUserToken" />
                <Button type="submit">Submit</Button>
              </form>
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
