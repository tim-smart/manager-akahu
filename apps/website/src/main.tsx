import "./index.css"

import { StrictMode, useEffect, useId, useRef, useState, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { akahuSetupStateAtom, akahuTransactionSyncAtom } from "./Manager/atoms"
import { AsyncResult } from "effect/unstable/reactivity"
import type {
  LinkedAccount,
  ManagerAkahuSetupState,
  StaleLinkedAccountSelection,
} from "@app/domain/Manager/AkahuCustomFields"
import { Button } from "@/components/ui/button"
import type { ManagerAkahuTransactionSyncSummary } from "./Manager/SyncFlows"
import {
  canCloseManagerAkahuSyncDialog,
  canStartManagerAkahuSyncDialog,
  closeManagerAkahuSyncDialog,
  completeManagerAkahuSyncDialog,
  failManagerAkahuSyncDialog,
  initialManagerAkahuSyncDialogState,
  managerAkahuSyncSummaryRows,
  openManagerAkahuSyncDialog,
  startManagerAkahuSyncDialog,
  type ManagerAkahuSyncDialogState,
} from "./Manager/SyncUi"

function App() {
  const setupState = useAtomValue(akahuSetupStateAtom)
  const refreshSetupState = useAtomRefresh(akahuSetupStateAtom)
  const runTransactionSync = useAtomSet(akahuTransactionSyncAtom, { mode: "promise" }) as (input: {
    readonly accounts: ReadonlyArray<LinkedAccount>
  }) => Promise<ManagerAkahuTransactionSyncSummary>
  const [syncDialog, setSyncDialog] = useState<ManagerAkahuSyncDialogState>(
    initialManagerAkahuSyncDialogState,
  )
  const syncInFlightRef = useRef(false)

  const openSyncDialog = (accounts: ReadonlyArray<LinkedAccount>) => {
    setSyncDialog((state) => openManagerAkahuSyncDialog(state, accounts))
  }

  const closeSyncDialog = () => {
    setSyncDialog((state) => closeManagerAkahuSyncDialog(state))
  }

  const startSync = () => {
    if (!canStartManagerAkahuSyncDialog(syncDialog) || syncInFlightRef.current) {
      return
    }

    const accounts = syncDialog.accounts
    syncInFlightRef.current = true
    setSyncDialog(startManagerAkahuSyncDialog(syncDialog))
    void runTransactionSync({ accounts }).then(
      (summary) => {
        syncInFlightRef.current = false
        setSyncDialog((state) => completeManagerAkahuSyncDialog(state, summary))
      },
      () => {
        syncInFlightRef.current = false
        setSyncDialog((state) =>
          failManagerAkahuSyncDialog(
            state,
            "Transaction sync failed before a summary was available. Check the Manager and Akahu connection, then try again.",
          ),
        )
      },
    )
  }

  return (
    <main className="min-h-svh bg-background px-4 py-10 text-foreground sm:px-6 sm:py-16">
      <section className="mx-auto flex max-w-4xl flex-col gap-8 rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        {AsyncResult.matchWithWaiting(setupState, {
          onWaiting: () => <LoadingSetup />,
          onError: () => <RetryableError onRetry={refreshSetupState} />,
          onDefect: () => <RetryableError onRetry={refreshSetupState} />,
          onSuccess: ({ value }) => (
            <SetupStateView
              setupState={value}
              onRetry={refreshSetupState}
              onSync={openSyncDialog}
              syncDisabled={syncDialog._tag === "running"}
            />
          ),
        })}
      </section>
      <SyncDialog state={syncDialog} onCancel={closeSyncDialog} onStart={startSync} />
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
  readonly onSync: (accounts: ReadonlyArray<LinkedAccount>) => void
  readonly syncDisabled: boolean
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
      const readySetupState = props.setupState
      return (
        <SetupStack>
          <SetupMessage
            eyebrow="Ready"
            title="Linked bank accounts"
            description="These Manager bank/cash accounts are linked to current Akahu accounts and can sync transactions already available from Akahu."
            action={
              <Button
                type="button"
                className="w-fit"
                disabled={props.syncDisabled}
                onClick={() => props.onSync(readySetupState.accounts)}
              >
                Sync all
              </Button>
            }
          />
          <StaleSelections selections={readySetupState.staleSelections} />
          <Accounts
            accounts={readySetupState.accounts}
            syncDisabled={props.syncDisabled}
            onSync={(account) => props.onSync([account])}
          />
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

function Accounts(props: {
  readonly accounts: ReadonlyArray<LinkedAccount>
  readonly syncDisabled: boolean
  readonly onSync: (account: LinkedAccount) => void
}) {
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
            <Button
              type="button"
              variant="outline"
              disabled={props.syncDisabled}
              onClick={() => props.onSync(account)}
            >
              Sync {account.name || "unnamed Manager account"}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function SyncDialog(props: {
  readonly state: ManagerAkahuSyncDialogState
  readonly onCancel: () => void
  readonly onStart: () => void
}) {
  const { onCancel, onStart, state } = props
  const titleId = useId()
  const descriptionId = useId()
  const initialFocusRef = useRef<HTMLButtonElement>(null)
  const canClose = canCloseManagerAkahuSyncDialog(state)

  useEffect(() => {
    if (state._tag === "closed") return
    initialFocusRef.current?.focus()
  }, [state._tag])

  useEffect(() => {
    if (!canClose || state._tag === "closed") return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [canClose, onCancel, state._tag])

  if (state._tag === "closed") return null

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-background/80 px-4 py-8 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && canClose) {
          onCancel()
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="max-h-full w-full max-w-3xl overflow-y-auto rounded-xl border bg-card p-6 shadow-lg sm:p-8"
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium tracking-[0.24em] text-muted-foreground uppercase">
              Transaction sync
            </p>
            <h2 id={titleId} className="text-2xl font-semibold tracking-tight">
              {syncDialogTitle(state)}
            </h2>
            <p id={descriptionId} className="text-sm leading-6 text-muted-foreground">
              {syncDialogDescription(state)}
            </p>
          </div>

          <SyncAccountList state={state} />

          {state._tag === "confirming" ? <SyncConfirmationDetails /> : null}
          {state._tag === "running" ? <SyncRunningDetails /> : null}
          {state._tag === "completed" ? <SyncSummary summary={state.summary} /> : null}
          {state._tag === "failed" ? <SyncFailure message={state.message} /> : null}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={!canClose}
              onClick={onCancel}
              ref={state._tag === "confirming" ? undefined : initialFocusRef}
            >
              {state._tag === "confirming" ? "Cancel" : "Close"}
            </Button>
            {state._tag === "confirming" ? (
              <Button
                type="button"
                disabled={!canStartManagerAkahuSyncDialog(state)}
                onClick={onStart}
                ref={initialFocusRef}
              >
                Start sync
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}

function syncDialogTitle(state: ManagerAkahuSyncDialogState): string {
  switch (state._tag) {
    case "confirming":
      return state.accounts.length === 1 ? "Confirm account sync" : "Confirm sync all"
    case "running":
      return "Sync running"
    case "completed":
      return "Sync completed"
    case "failed":
      return "Sync failed"
    case "closed":
      return "Transaction sync"
  }
}

function syncDialogDescription(state: ManagerAkahuSyncDialogState): string {
  switch (state._tag) {
    case "confirming":
      return "Review the selected Manager accounts before importing transactions. No Manager writes happen until you start the sync."
    case "running":
      return "Sync is running. Keep this window open until the sync completes."
    case "completed":
      return "Final summary counts, warnings, and errors are shown below."
    case "failed":
      return "The sync failed before the service returned a summary. No credential values are shown here."
    case "closed":
      return "Transaction sync dialog."
  }
}

function SyncAccountList(props: {
  readonly state: Exclude<ManagerAkahuSyncDialogState, { readonly _tag: "closed" }>
}) {
  return (
    <section className="flex flex-col gap-3" aria-label="Selected accounts">
      <h3 className="font-medium">Accounts</h3>
      <ul className="flex flex-col gap-2">
        {props.state.accounts.map((account) => (
          <li key={account.key} className="rounded-lg border bg-background px-4 py-3 text-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-medium">{account.name || "Unnamed Manager account"}</span>
              <span className="text-muted-foreground">
                {syncAccountStatus(props.state, account)}
              </span>
            </div>
            <div className="mt-1 text-muted-foreground">
              Akahu: {account.akahuAccount.name}. Pending transactions:{" "}
              {account.canHavePendingTransactions ? "included" : "not supported"}.
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function syncAccountStatus(
  state: Exclude<ManagerAkahuSyncDialogState, { readonly _tag: "closed" }>,
  account: LinkedAccount,
): string {
  if (state._tag === "confirming") return "Queued"
  if (state._tag === "running") return "Queued or running"
  if (state._tag === "failed") return "Failed before summary"
  const accountSummary = state.summary.accounts.find(
    (summary) => summary.account.key === account.key,
  )
  if (accountSummary === undefined) return "No summary returned"
  return accountSummary.counts.errors > 0 ? "Completed with errors" : "Completed"
}

function SyncConfirmationDetails() {
  return (
    <section
      className="rounded-lg border bg-muted/40 p-4 text-sm leading-6"
      aria-label="Sync behavior"
    >
      <p>
        Settled Akahu transactions will be checked from newest to oldest until five already-imported
        overlaps are found, using transactions already available from Akahu.
      </p>
      <p className="mt-3">
        Pending transactions are included only for linked Manager accounts that support pending
        transactions.
      </p>
    </section>
  )
}

function SyncRunningDetails() {
  return (
    <section className="flex flex-col gap-3" aria-label="Sync progress">
      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full w-1/2 rounded-full bg-primary" />
      </div>
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        Overall status: running. Account progress will update when the sync service returns its
        summary.
      </p>
    </section>
  )
}

function SyncSummary(props: { readonly summary: ManagerAkahuTransactionSyncSummary }) {
  return (
    <div className="flex flex-col gap-5">
      <SummaryCounts title="Overall summary" counts={props.summary.overall} />
      <section className="flex flex-col gap-3" aria-label="Account summaries">
        <h3 className="font-medium">Account summaries</h3>
        {props.summary.accounts.map((accountSummary) => (
          <div key={accountSummary.account.key} className="rounded-lg border bg-background p-4">
            <SummaryCounts
              title={accountSummary.account.name || "Unnamed Manager account"}
              counts={accountSummary.counts}
            />
            <SyncDetails title="Warnings" items={accountSummary.warnings} />
            <SyncDetails title="Errors" items={accountSummary.errors} />
          </div>
        ))}
      </section>
    </div>
  )
}

function SummaryCounts(props: {
  readonly title: string
  readonly counts: ManagerAkahuTransactionSyncSummary["overall"]
}) {
  return (
    <section className="flex flex-col gap-3" aria-label={props.title}>
      <h3 className="font-medium">{props.title}</h3>
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {managerAkahuSyncSummaryRows.map((row) => (
          <div key={row.key} className="rounded-md bg-muted px-3 py-2">
            <dt className="text-[0.7rem] font-medium tracking-[0.16em] text-muted-foreground uppercase">
              {row.label}
            </dt>
            <dd className="mt-1 text-sm font-medium">{props.counts[row.key]}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function SyncDetails(props: { readonly title: string; readonly items: ReadonlyArray<string> }) {
  if (props.items.length === 0) return null

  return (
    <section className="mt-4 flex flex-col gap-2" aria-label={props.title}>
      <h4 className="text-sm font-medium">{props.title}</h4>
      <ul className="flex flex-col gap-2">
        {props.items.map((item, index) => (
          <li
            key={`${props.title}-${index}`}
            className="rounded-md border bg-card px-3 py-2 text-sm"
          >
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}

function SyncFailure(props: { readonly message: string }) {
  return (
    <section className="rounded-lg border bg-muted/40 p-4" aria-label="Sync failure">
      <h3 className="font-medium">Error</h3>
      <p className="mt-2 text-sm text-muted-foreground">{props.message}</p>
    </section>
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
