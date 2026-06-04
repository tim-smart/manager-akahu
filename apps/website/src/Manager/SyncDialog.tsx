import { useEffect, useRef } from "react"
import { Dialog } from "radix-ui"
import type { LinkedAccount } from "@app/domain/Manager/AkahuCustomFields"
import { Button } from "@/components/ui/button"
import type { ManagerAkahuTransactionSyncSummary } from "./SyncFlows"
import {
  canCloseManagerAkahuSyncDialog,
  canStartManagerAkahuSyncDialog,
  managerAkahuSyncSummaryRows,
  type ManagerAkahuSyncDialogState,
} from "./SyncUi"

export function SyncDialog(props: {
  readonly state: ManagerAkahuSyncDialogState
  readonly restoreFocusElement: HTMLButtonElement | null
  readonly onCancel: () => void
  readonly onStart: () => void
}) {
  const { onCancel, onStart, restoreFocusElement, state } = props
  const contentRef = useRef<HTMLDivElement>(null)
  const initialFocusRef = useRef<HTMLButtonElement>(null)
  const canClose = canCloseManagerAkahuSyncDialog(state)
  const isOpen = state._tag !== "closed"

  useEffect(() => {
    if (!isOpen) return
    focusSyncDialogStateTarget(state, initialFocusRef.current, contentRef.current)
  }, [isOpen, state])

  return (
    <Dialog.Root
      modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && canClose) {
          onCancel()
        }
      }}
    >
      {state._tag === "closed" ? null : (
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-background/80 backdrop-blur-sm" />
          <Dialog.Content
            ref={contentRef}
            tabIndex={-1}
            className="fixed top-1/2 left-1/2 max-h-[calc(100svh-4rem)] w-[calc(100vw-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 shadow-lg outline-none sm:p-8"
            onEscapeKeyDown={(event) => {
              if (!canClose) {
                event.preventDefault()
              }
            }}
            onPointerDownOutside={(event) => {
              if (!canClose) {
                event.preventDefault()
              }
            }}
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              focusSyncDialogStateTarget(state, initialFocusRef.current, contentRef.current)
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              restoreFocusElement?.focus()
            }}
          >
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium tracking-[0.24em] text-muted-foreground uppercase">
                  Transaction sync
                </p>
                <Dialog.Title className="text-2xl font-semibold tracking-tight">
                  {syncDialogTitle(state)}
                </Dialog.Title>
                <Dialog.Description className="text-sm leading-6 text-muted-foreground">
                  {syncDialogDescription(state)}
                </Dialog.Description>
              </div>

              <SyncAccountList state={state} />

              {state._tag === "confirming" ? <SyncConfirmationDetails /> : null}
              {state._tag === "running" ? <SyncRunningDetails /> : null}
              {state._tag === "completed" ? <SyncSummary summary={state.summary} /> : null}
              {state._tag === "failed" ? <SyncFailure message={state.message} /> : null}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Dialog.Close asChild>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!canClose}
                    ref={state._tag === "confirming" ? undefined : initialFocusRef}
                  >
                    {state._tag === "confirming" ? "Cancel" : "Close"}
                  </Button>
                </Dialog.Close>
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
          </Dialog.Content>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  )
}

function focusSyncDialogStateTarget(
  state: ManagerAkahuSyncDialogState,
  initialFocusElement: HTMLButtonElement | null,
  contentElement: HTMLDivElement | null,
) {
  if (state._tag === "closed") return
  if (state._tag === "running") {
    contentElement?.focus()
    return
  }
  initialFocusElement?.focus()
}

function syncDialogTitle(state: Exclude<ManagerAkahuSyncDialogState, { readonly _tag: "closed" }>) {
  switch (state._tag) {
    case "confirming":
      return state.accounts.length === 1 ? "Confirm account sync" : "Confirm sync all"
    case "running":
      return "Sync running"
    case "completed":
      return "Sync completed"
    case "failed":
      return "Sync failed"
  }
}

function syncDialogDescription(
  state: Exclude<ManagerAkahuSyncDialogState, { readonly _tag: "closed" }>,
) {
  switch (state._tag) {
    case "confirming":
      return "Review the selected Manager accounts before importing transactions. No Manager writes happen until you start the sync."
    case "running":
      return "Sync is running. Keep this window open until the sync completes."
    case "completed":
      return "Final summary counts, warnings, and errors are shown below."
    case "failed":
      return "The sync failed before the service returned a summary. No credential values are shown here."
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
) {
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
