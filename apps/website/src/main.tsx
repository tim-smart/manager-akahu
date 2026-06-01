import "./index.css"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { akahuSetupStateAtom, akahuTransactionSyncAtom } from "./Manager/atoms"
import { AsyncResult } from "effect/unstable/reactivity"
import type { LinkedAccount, ManagerAkahuSetupState } from "@app/domain/Manager/AkahuCustomFields"
import { Button } from "@/components/ui/button"
import type { ManagerAkahuTransactionSyncSummary } from "./Manager/SyncFlows"
import { LinkedAccountsSyncSection } from "./Manager/LinkedAccountsSyncSection"
import { SetupMessage, SetupStack, StaleSelections } from "./Manager/SetupUi"
import { useManagerAkahuSyncController } from "./Manager/useManagerAkahuSyncController"

function App() {
  const setupState = useAtomValue(akahuSetupStateAtom)
  const refreshSetupState = useAtomRefresh(akahuSetupStateAtom)
  const runTransactionSync = useAtomSet(akahuTransactionSyncAtom, { mode: "promise" }) as (input: {
    readonly accounts: ReadonlyArray<LinkedAccount>
  }) => Promise<ManagerAkahuTransactionSyncSummary>
  const syncController = useManagerAkahuSyncController(runTransactionSync)

  return (
    <main className="min-h-svh bg-background px-4 py-10 text-foreground sm:px-6 sm:py-16">
      <section className="mx-auto flex max-w-4xl flex-col gap-8 rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        {AsyncResult.matchWithWaiting(setupState, {
          onWaiting: () => <LoadingSetup />,
          onError: () => <RetryableError onRetry={refreshSetupState} />,
          onDefect: () => <RetryableError onRetry={refreshSetupState} />,
          onSuccess: ({ value }) =>
            value._tag === "ready" ? (
              <LinkedAccountsSyncSection
                setupState={value}
                syncState={syncController.state}
                onOpen={syncController.open}
                onCancel={syncController.close}
                onStart={syncController.start}
              />
            ) : (
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
  readonly setupState: Exclude<ManagerAkahuSetupState, { readonly _tag: "ready" }>
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

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
