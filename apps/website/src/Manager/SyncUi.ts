import type { LinkedAccount } from "@app/domain/Manager/AkahuCustomFields"
import {
  managerAkahuSyncSummaryCountKeys,
  type ManagerAkahuSyncSummaryCountKey,
} from "@app/manager-api/ManagerAkahuTransactionSync"
import type { ManagerAkahuTransactionSyncSummary } from "./SyncFlows"

export type ManagerAkahuSyncDialogState =
  | { readonly _tag: "closed" }
  | { readonly _tag: "confirming"; readonly accounts: ReadonlyArray<LinkedAccount> }
  | { readonly _tag: "running"; readonly accounts: ReadonlyArray<LinkedAccount> }
  | {
      readonly _tag: "completed"
      readonly accounts: ReadonlyArray<LinkedAccount>
      readonly summary: ManagerAkahuTransactionSyncSummary
    }
  | {
      readonly _tag: "failed"
      readonly accounts: ReadonlyArray<LinkedAccount>
      readonly message: string
    }

export const initialManagerAkahuSyncDialogState: ManagerAkahuSyncDialogState = { _tag: "closed" }

export const managerAkahuSyncSummaryCountLabels: Record<ManagerAkahuSyncSummaryCountKey, string> = {
  settledFetched: "Settled fetched",
  pendingFetched: "Pending fetched",
  receiptsCreated: "Receipts created",
  paymentsCreated: "Payments created",
  duplicatesSkipped: "Duplicates skipped",
  zeroAmountSkipped: "Zero amounts skipped",
  unsupportedSkipped: "Unsupported skipped",
  pendingCreated: "Pending created",
  pendingUpdated: "Pending updated",
  pendingSettled: "Pending settled",
  stalePendingDetected: "Stale pending detected",
  warnings: "Warnings",
  errors: "Errors",
}

export const managerAkahuSyncSummaryRows = managerAkahuSyncSummaryCountKeys.map((key) => ({
  key,
  label: managerAkahuSyncSummaryCountLabels[key],
}))

export const openManagerAkahuSyncDialog = (
  state: ManagerAkahuSyncDialogState,
  accounts: ReadonlyArray<LinkedAccount>,
): ManagerAkahuSyncDialogState =>
  state._tag === "running" || accounts.length === 0 ? state : { _tag: "confirming", accounts }

export const startManagerAkahuSyncDialog = (
  state: ManagerAkahuSyncDialogState,
): ManagerAkahuSyncDialogState =>
  state._tag === "confirming" ? { _tag: "running", accounts: state.accounts } : state

export const completeManagerAkahuSyncDialog = (
  state: ManagerAkahuSyncDialogState,
  summary: ManagerAkahuTransactionSyncSummary,
): ManagerAkahuSyncDialogState =>
  state._tag === "running" ? { _tag: "completed", accounts: state.accounts, summary } : state

export const failManagerAkahuSyncDialog = (
  state: ManagerAkahuSyncDialogState,
  message: string,
): ManagerAkahuSyncDialogState =>
  state._tag === "running" ? { _tag: "failed", accounts: state.accounts, message } : state

export const closeManagerAkahuSyncDialog = (
  state: ManagerAkahuSyncDialogState,
): ManagerAkahuSyncDialogState =>
  state._tag === "running" ? state : initialManagerAkahuSyncDialogState

export const canStartManagerAkahuSyncDialog = (
  state: ManagerAkahuSyncDialogState,
): state is Extract<ManagerAkahuSyncDialogState, { readonly _tag: "confirming" }> =>
  state._tag === "confirming"

export const canCloseManagerAkahuSyncDialog = (state: ManagerAkahuSyncDialogState): boolean =>
  state._tag !== "running"

export const sanitizeManagerAkahuSyncDialogText = (text: string): string =>
  text
    .replace(/((?:Akahu\s+)?(?:App|User)\s+Token["']?\s*[:=]\s*)[^\s,;)}\]]+/gi, "$1[redacted]")
    .replace(
      /((?:akahuAppToken|akahuUserToken|app_token|user_token|x-akahu-app-token|x-akahu-user-token)["']?\s*[:=]\s*)[^\s,;)}\]]+/gi,
      "$1[redacted]",
    )
    .replace(/(Authorization["']?\s*[:=]\s*)(?:Bearer\s+)?[^\s,;)}\]]+/gi, "$1[redacted]")

export const sanitizeManagerAkahuTransactionSyncSummary = (
  summary: ManagerAkahuTransactionSyncSummary,
): ManagerAkahuTransactionSyncSummary => ({
  ...summary,
  accounts: summary.accounts.map((accountSummary) => ({
    ...accountSummary,
    warnings: accountSummary.warnings.map(sanitizeManagerAkahuSyncDialogText),
    errors: accountSummary.errors.map(sanitizeManagerAkahuSyncDialogText),
  })),
})
