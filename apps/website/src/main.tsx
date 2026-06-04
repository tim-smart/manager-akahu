import "./index.css"

import { StrictMode, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { akahuSetupStateAtom } from "./Manager/atoms"
import { AsyncResult } from "effect/unstable/reactivity"
import type {
  LinkedAccount,
  ManagerAkahuSetupState,
  StaleLinkedAccountSelection,
} from "@app/domain/Manager/AkahuCustomFields"
import { Button } from "@/components/ui/button"

function App() {
  const setupState = useAtomValue(akahuSetupStateAtom)
  const refreshSetupState = useAtomRefresh(akahuSetupStateAtom)

  return (
    <main className="min-h-svh bg-background px-4 py-10 text-foreground sm:px-6 sm:py-16">
      <section className="mx-auto flex max-w-4xl flex-col gap-8 rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        {AsyncResult.matchWithWaiting(setupState, {
          onWaiting: () => <LoadingSetup />,
          onError: () => <RetryableError onRetry={refreshSetupState} />,
          onDefect: () => <RetryableError onRetry={refreshSetupState} />,
          onSuccess: ({ value }) => (
            <SetupStateView setupState={value} onRetry={refreshSetupState} />
          ),
        })}
      </section>
    </main>
  )
}

function LoadingSetup() {
  return (
    <SetupMessage
      eyebrow="Manager and Akahu"
      title="Loading setup"
      description="Checking Manager custom fields, Business Details, Akahu accounts, and linked bank/cash accounts."
    />
  )
}

function SetupStateView(props: {
  readonly setupState: ManagerAkahuSetupState
  readonly onRetry: () => void
}) {
  switch (props.setupState._tag) {
    case "loading":
      return <LoadingSetup />
    case "missingCredentials":
      return (
        <SetupMessage
          eyebrow="Setup required"
          title="Akahu credentials required"
          description={
            props.setupState.missingFieldNames.length === 2
              ? "Add your Akahu App Token and Akahu User Token in Manager Business Details before syncing bank accounts. This extension reads those Business Details custom fields to connect to Akahu."
              : `Add your ${props.setupState.missingFieldNames[0]} in Manager Business Details before syncing bank accounts. This extension reads the Akahu App Token and Akahu User Token custom fields to connect to Akahu.`
          }
        />
      )
    case "invalidCredentials":
      return (
        <SetupMessage
          eyebrow="Credentials"
          title="Akahu credentials could not be used"
          description="Check the Akahu App Token and Akahu User Token in Manager Business Details, then try again."
          action={<RetryButton onRetry={props.onRetry} />}
        />
      )
    case "noAkahuAccounts":
      return (
        <SetupStack>
          <SetupMessage
            eyebrow="Akahu"
            title="No Akahu accounts available"
            description="Your Akahu credentials are valid, but no bank accounts are available to this application. Connect accounts in Akahu before linking Manager bank/cash accounts."
          />
          <StaleSelections selections={props.setupState.staleSelections} />
        </SetupStack>
      )
    case "noLinkedManagerAccounts":
      return (
        <SetupStack>
          <SetupMessage
            eyebrow="Manager"
            title="No bank accounts linked"
            description="Create or edit a Manager bank/cash account and choose the matching Akahu account in the Akahu Account custom field. Linked accounts will appear here with sync options."
          />
          <StaleSelections selections={props.setupState.staleSelections} />
        </SetupStack>
      )
    case "ready":
      return (
        <SetupStack>
          <SetupMessage
            eyebrow="Ready"
            title="Linked bank accounts"
            description="These Manager bank/cash accounts are linked to current Akahu accounts. Sync controls will be added in the next setup step."
          />
          <StaleSelections selections={props.setupState.staleSelections} />
          <Accounts accounts={props.setupState.accounts} />
        </SetupStack>
      )
    case "error":
      return (
        <SetupMessage
          eyebrow="Retryable error"
          title="Setup information could not be loaded"
          description={props.setupState.message}
          action={<RetryButton onRetry={props.onRetry} />}
        />
      )
  }
}

function SetupStack(props: { readonly children: ReactNode }) {
  return <div className="flex flex-col gap-6">{props.children}</div>
}

function SetupMessage(props: {
  readonly eyebrow: string
  readonly title: string
  readonly description: string
  readonly action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium tracking-[0.24em] text-muted-foreground uppercase">
          {props.eyebrow}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{props.title}</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          {props.description}
        </p>
      </div>
      {props.action}
    </div>
  )
}

function RetryableError(props: { readonly onRetry: () => void }) {
  return (
    <SetupMessage
      eyebrow="Retryable error"
      title="Setup information could not be loaded"
      description="Manager or Akahu setup information was not available. Try again after checking the connection."
      action={<RetryButton onRetry={props.onRetry} />}
    />
  )
}

function RetryButton(props: { readonly onRetry: () => void }) {
  return (
    <Button type="button" variant="outline" className="w-fit" onClick={props.onRetry}>
      Retry setup check
    </Button>
  )
}

function Accounts(props: { readonly accounts: ReadonlyArray<LinkedAccount> }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {props.accounts.map((account) => (
        <li key={account.key} className="rounded-lg border bg-background p-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="font-medium">{account.name || "Unnamed Manager account"}</h2>
              <p className="text-sm text-muted-foreground">{account.akahuAccount.name}</p>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <AccountMetadata label="Currency" value={account.currency ?? "Base currency"} />
              <AccountMetadata
                label="Pending transactions"
                value={account.canHavePendingTransactions ? "Supported" : "Not supported"}
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function AccountMetadata(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-md bg-muted px-3 py-2">
      <div className="text-[0.7rem] font-medium tracking-[0.16em] text-muted-foreground uppercase">
        {props.label}
      </div>
      <div className="mt-1 text-sm">{props.value}</div>
    </div>
  )
}

function StaleSelections(props: {
  readonly selections: ReadonlyArray<StaleLinkedAccountSelection>
}) {
  if (props.selections.length === 0) return null

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4"
      aria-label="Stale Akahu selections"
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">Stale Akahu account selections</h2>
        <p className="text-sm text-muted-foreground">
          These Manager bank/cash accounts point to Akahu accounts that are not currently available.
          Edit each Manager account and choose a current Akahu Account value.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {props.selections.map((selection) => (
          <li key={selection.key} className="rounded-md border bg-background px-3 py-2 text-sm">
            <span className="font-medium">{selection.name || "Unnamed Manager account"}</span>
            <span className="text-muted-foreground">
              {" "}
              uses {selection.selectedAkahuAccountLabel ?? "unknown Akahu account"} (
              {selection.selectedAkahuAccountId})
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
