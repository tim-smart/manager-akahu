import "./index.css"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { useAtomValue } from "@effect/atom-react"
import { akakuFieldsAtom } from "./Manager/atoms"
import { AsyncResult } from "effect/unstable/reactivity"
import type { LinkedAccount } from "@app/domain/Manager/AkahuCustomFields"

function App() {
  const fields = useAtomValue(akakuFieldsAtom)

  return (
    <main className="min-h-svh bg-background px-6 py-16 text-foreground">
      <section className="mx-auto flex max-w-3xl flex-col gap-6 rounded-xl border bg-card p-8 shadow-sm">
        <div className="space-y-2">
          {AsyncResult.builder(fields)
            .onSuccess((fields) => <Accounts accounts={fields.accounts} />)
            .onErrorTag("NoSuchElementError", () => (
              <p className="text-muted-foreground">No credentials found</p>
            ))
            .orNull()}
        </div>
      </section>
    </main>
  )
}

function Accounts(props: { readonly accounts: ReadonlyArray<LinkedAccount> }) {
  if (props.accounts.length === 0) {
    return <p className="text-muted-foreground">No accounts found</p>
  }
  return (
    <ul className="space-y-2">
      {props.accounts.map((account) => (
        <li key={account.key}>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex flex-col">
              <div className="flex items-center gap-1">
                <div className="text-muted-foreground">{account.name}</div>
              </div>
              <div className="text-muted-foreground text-sm">{account.akahuAccount.name}</div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
