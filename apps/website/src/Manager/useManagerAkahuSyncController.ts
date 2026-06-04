import { useRef, useState } from "react"
import type { LinkedAccount } from "@app/domain/Manager/AkahuCustomFields"
import type { ManagerAkahuTransactionSyncSummary } from "./SyncFlows"
import {
  canStartManagerAkahuSyncDialog,
  closeManagerAkahuSyncDialog,
  completeManagerAkahuSyncDialog,
  failManagerAkahuSyncDialog,
  initialManagerAkahuSyncDialogState,
  openManagerAkahuSyncDialog,
  startManagerAkahuSyncDialog,
  type ManagerAkahuSyncDialogState,
} from "./SyncUi"

export type RunManagerAkahuTransactionSync = (input: {
  readonly accounts: ReadonlyArray<LinkedAccount>
}) => Promise<ManagerAkahuTransactionSyncSummary>

export type ManagerAkahuSyncController = {
  readonly state: ManagerAkahuSyncDialogState
  readonly isRunning: boolean
  readonly open: (accounts: ReadonlyArray<LinkedAccount>) => void
  readonly close: () => void
  readonly start: () => void
}

export const managerAkahuSyncFailureMessage =
  "Transaction sync failed before a summary was available. Check the Manager and Akahu connection, then try again."

export type SetManagerAkahuSyncDialogState = (
  state:
    | ManagerAkahuSyncDialogState
    | ((state: ManagerAkahuSyncDialogState) => ManagerAkahuSyncDialogState),
) => void

export type ManagerAkahuSyncInFlightRef = { current: boolean }

export const closeManagerAkahuSyncController = (setState: SetManagerAkahuSyncDialogState): void => {
  setState((current) => closeManagerAkahuSyncDialog(current))
}

export const startManagerAkahuSyncController = (input: {
  readonly state: ManagerAkahuSyncDialogState
  readonly inFlightRef: ManagerAkahuSyncInFlightRef
  readonly setState: SetManagerAkahuSyncDialogState
  readonly runTransactionSync: RunManagerAkahuTransactionSync
}): void => {
  if (!canStartManagerAkahuSyncDialog(input.state) || input.inFlightRef.current) {
    return
  }

  const accounts = input.state.accounts
  input.inFlightRef.current = true
  input.setState(startManagerAkahuSyncDialog(input.state))
  void input.runTransactionSync({ accounts }).then(
    (summary) => {
      input.inFlightRef.current = false
      input.setState((current) => completeManagerAkahuSyncDialog(current, summary))
    },
    () => {
      input.inFlightRef.current = false
      input.setState((current) =>
        failManagerAkahuSyncDialog(current, managerAkahuSyncFailureMessage),
      )
    },
  )
}

export const useManagerAkahuSyncController = (
  runTransactionSync: RunManagerAkahuTransactionSync,
): ManagerAkahuSyncController => {
  const [state, setState] = useState<ManagerAkahuSyncDialogState>(
    initialManagerAkahuSyncDialogState,
  )
  const inFlightRef = useRef(false)

  const open = (accounts: ReadonlyArray<LinkedAccount>) => {
    setState((current) => openManagerAkahuSyncDialog(current, accounts))
  }

  const close = () => {
    closeManagerAkahuSyncController(setState)
  }

  const start = () => {
    startManagerAkahuSyncController({ state, inFlightRef, setState, runTransactionSync })
  }

  return {
    state,
    isRunning: state._tag === "running",
    open,
    close,
    start,
  }
}
