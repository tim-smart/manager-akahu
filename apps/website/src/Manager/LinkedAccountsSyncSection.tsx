import type { ReactNode } from "react"
import { Dialog } from "radix-ui"
import type { LinkedAccount, ManagerAkahuSetupState } from "@app/domain/Manager/AkahuCustomFields"
import { Button } from "@/components/ui/button"
import { SyncDialogContent } from "./SyncDialog"
import { canCloseManagerAkahuSyncDialog, type ManagerAkahuSyncDialogState } from "./SyncUi"
import { SetupMessage, SetupStack, StaleSelections } from "./SetupUi"

type ReadyManagerAkahuSetupState = Extract<ManagerAkahuSetupState, { readonly _tag: "ready" }>

export function LinkedAccountsSyncSection(props: {
  readonly setupState: ReadyManagerAkahuSetupState
  readonly syncState: ManagerAkahuSyncDialogState
  readonly onOpen: (accounts: ReadonlyArray<LinkedAccount>) => void
  readonly onCancel: () => void
  readonly onStart: () => void
}) {
  const canClose = canCloseManagerAkahuSyncDialog(props.syncState)
  const syncDisabled = props.syncState._tag === "running"

  return (
    <Dialog.Root
      modal
      open={props.syncState._tag !== "closed"}
      onOpenChange={(open) => {
        if (!open && canClose) {
          props.onCancel()
        }
      }}
    >
      <SetupStack>
        <SetupMessage
          eyebrow="Ready"
          title="Linked bank accounts"
          description="These Manager bank/cash accounts are linked to current Akahu accounts and can sync transactions already available from Akahu."
          action={
            <SyncDialogTriggerButton
              accounts={props.setupState.accounts}
              className="w-fit"
              disabled={syncDisabled}
              onSync={props.onOpen}
            >
              Sync all
            </SyncDialogTriggerButton>
          }
        />
        <StaleSelections selections={props.setupState.staleSelections} />
        <LinkedAccountsList
          accounts={props.setupState.accounts}
          disabled={syncDisabled}
          onSync={props.onOpen}
        />
      </SetupStack>
      <SyncDialogContent state={props.syncState} onStart={props.onStart} />
    </Dialog.Root>
  )
}

function LinkedAccountsList(props: {
  readonly accounts: ReadonlyArray<LinkedAccount>
  readonly disabled: boolean
  readonly onSync: (accounts: ReadonlyArray<LinkedAccount>) => void
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
            <SyncDialogTriggerButton
              accounts={[account]}
              variant="outline"
              disabled={props.disabled}
              onSync={props.onSync}
            >
              Sync {account.name || "unnamed Manager account"}
            </SyncDialogTriggerButton>
          </div>
        </li>
      ))}
    </ul>
  )
}

function SyncDialogTriggerButton(props: {
  readonly accounts: ReadonlyArray<LinkedAccount>
  readonly children: ReactNode
  readonly disabled: boolean
  readonly onSync: (accounts: ReadonlyArray<LinkedAccount>) => void
  readonly className?: string
  readonly variant?: "default" | "outline"
}) {
  return (
    <Dialog.Trigger asChild>
      <Button
        type="button"
        variant={props.variant}
        className={props.className}
        disabled={props.disabled}
        onClick={() => props.onSync(props.accounts)}
      >
        {props.children}
      </Button>
    </Dialog.Trigger>
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
