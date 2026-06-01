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
  sanitizeManagerAkahuSyncDialogText,
  sanitizeManagerAkahuTransactionSyncSummary,
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

export type SetManagerAkahuSyncDialogState = (state: ManagerAkahuSyncDialogState) => void

export type ManagerAkahuSyncInFlightRef = { current: boolean }
export type ManagerAkahuSyncDialogStateRef = { current: ManagerAkahuSyncDialogState }

export type ManagerAkahuSyncControllerState = {
  readonly stateRef: ManagerAkahuSyncDialogStateRef
  readonly setState: SetManagerAkahuSyncDialogState
}

const setManagerAkahuSyncControllerState = (
  controllerState: ManagerAkahuSyncControllerState,
  state: ManagerAkahuSyncDialogState,
): void => {
  controllerState.stateRef.current = state
  controllerState.setState(state)
}

const updateManagerAkahuSyncControllerState = (
  controllerState: ManagerAkahuSyncControllerState,
  transition: (state: ManagerAkahuSyncDialogState) => ManagerAkahuSyncDialogState,
): void => {
  setManagerAkahuSyncControllerState(controllerState, transition(controllerState.stateRef.current))
}

export const closeManagerAkahuSyncController = (
  controllerState: ManagerAkahuSyncControllerState,
): void => {
  updateManagerAkahuSyncControllerState(controllerState, closeManagerAkahuSyncDialog)
}

export const startManagerAkahuSyncController = (input: {
  readonly inFlightRef: ManagerAkahuSyncInFlightRef
  readonly controllerState: ManagerAkahuSyncControllerState
  readonly runTransactionSync: RunManagerAkahuTransactionSync
}): void => {
  const current = input.controllerState.stateRef.current
  if (!canStartManagerAkahuSyncDialog(current) || input.inFlightRef.current) {
    return
  }

  const selectedAccounts = current.accounts
  input.inFlightRef.current = true
  setManagerAkahuSyncControllerState(input.controllerState, startManagerAkahuSyncDialog(current))

  void Promise.resolve()
    .then(() => input.runTransactionSync({ accounts: selectedAccounts }))
    .then(
      (summary) => {
        input.inFlightRef.current = false
        updateManagerAkahuSyncControllerState(input.controllerState, (current) =>
          completeManagerAkahuSyncDialog(
            current,
            sanitizeManagerAkahuTransactionSyncSummary(summary),
          ),
        )
      },
      () => {
        input.inFlightRef.current = false
        updateManagerAkahuSyncControllerState(input.controllerState, (current) =>
          failManagerAkahuSyncDialog(
            current,
            sanitizeManagerAkahuSyncDialogText(managerAkahuSyncFailureMessage),
          ),
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
  const stateRef = useRef<ManagerAkahuSyncDialogState>(initialManagerAkahuSyncDialogState)
  const inFlightRef = useRef(false)
  const controllerState = { stateRef, setState }

  const open = (accounts: ReadonlyArray<LinkedAccount>) => {
    updateManagerAkahuSyncControllerState(controllerState, (current) =>
      openManagerAkahuSyncDialog(current, accounts),
    )
  }

  const close = () => {
    closeManagerAkahuSyncController(controllerState)
  }

  const start = () => {
    startManagerAkahuSyncController({ inFlightRef, controllerState, runTransactionSync })
  }

  return {
    state,
    isRunning: state._tag === "running",
    open,
    close,
    start,
  }
}
