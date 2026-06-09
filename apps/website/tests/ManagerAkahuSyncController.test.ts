import { Account, AccountId } from "@app/domain/Akahu"
import { LinkedAccount } from "@app/domain/Manager/AkahuCustomFields"
import { emptyManagerAkahuSyncSummaryCounts } from "@app/manager-api/ManagerAkahuTransactionSync"
import { DateTime, Schema } from "effect"
import { expect, it } from "@effect/vitest"
import type { ManagerAkahuTransactionSyncSummary } from "../src/Manager/SyncFlows.ts"
import {
  closeManagerAkahuSyncController,
  managerAkahuSyncFailureMessage,
  startManagerAkahuSyncController,
  type ManagerAkahuSyncControllerState,
  type RunManagerAkahuTransactionSync,
} from "../src/Manager/useManagerAkahuSyncController.ts"
import {
  closeManagerAkahuSyncDialog,
  initialManagerAkahuSyncDialogState,
  managerAkahuSyncSummaryCountLabels,
  managerAkahuSyncSummaryRows,
  openManagerAkahuSyncDialog,
  sanitizeManagerAkahuSyncDialogText,
  type ManagerAkahuSyncDialogState,
} from "../src/Manager/SyncUi.ts"

const accountId = Schema.decodeSync(AccountId)("akahu-checking")

const akahuAccount = new Account({
  _id: accountId,
  name: "Akahu Checking",
  refreshed: {
    meta: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
    transactions: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
    party: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
  },
})

const linkedAccount = () =>
  new LinkedAccount({
    key: "manager-checking",
    name: "Manager Checking",
    currency: null,
    canHavePendingTransactions: true,
    akahuAccount,
    transferRules: [],
    transferRuleWarnings: [],
  })

const summaryFor = (account: LinkedAccount): ManagerAkahuTransactionSyncSummary => ({
  accounts: [
    {
      account,
      counts: emptyManagerAkahuSyncSummaryCounts(),
      warnings: [],
      errors: [],
    },
  ],
  overall: emptyManagerAkahuSyncSummaryCounts(),
})

const flushSyncControllerPromises = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const immediateControllerState = (
  initialState: ManagerAkahuSyncDialogState,
): ManagerAkahuSyncControllerState => {
  const stateRef = { current: initialState }
  return {
    stateRef,
    setState: (next) => {
      stateRef.current = next
    },
  }
}

const deferredControllerState = (initialState: ManagerAkahuSyncDialogState) => {
  let renderedState = initialState
  const queuedStates: Array<ManagerAkahuSyncDialogState> = []
  const stateRef = { current: initialState }
  const controllerState: ManagerAkahuSyncControllerState = {
    stateRef,
    setState: (next) => {
      queuedStates.push(next)
    },
  }

  return {
    controllerState,
    renderedState: () => renderedState,
    pendingStateCount: () => queuedStates.length,
    flushRenderedState: () => {
      for (const state of queuedStates.splice(0)) {
        renderedState = state
      }
    },
  }
}

it("invokes the sync mutation only once when Start is clicked twice before rerender", async () => {
  const account = linkedAccount()
  const controllerState = immediateControllerState(
    openManagerAkahuSyncDialog(initialManagerAkahuSyncDialogState, [account]),
  )
  const inFlightRef = { current: false }
  let resolveSync: (summary: ManagerAkahuTransactionSyncSummary) => void = () => {}
  const syncPromise = new Promise<ManagerAkahuTransactionSyncSummary>((resolve) => {
    resolveSync = resolve
  })
  let syncCalls = 0
  const runTransactionSync: RunManagerAkahuTransactionSync = () => {
    syncCalls += 1
    return syncPromise
  }
  expect(controllerState.stateRef.current._tag).toBe("confirming")

  startManagerAkahuSyncController({ inFlightRef, controllerState, runTransactionSync })
  startManagerAkahuSyncController({ inFlightRef, controllerState, runTransactionSync })

  expect(controllerState.stateRef.current._tag).toBe("running")
  await Promise.resolve()
  expect(syncCalls).toBe(1)

  resolveSync(summaryFor(account))
  await syncPromise
  await flushSyncControllerPromises()
  expect(controllerState.stateRef.current._tag).toBe("completed")
})

it("starts atomically with a deferred React-style state setter", async () => {
  const account = linkedAccount()
  const { controllerState, renderedState, flushRenderedState, pendingStateCount } =
    deferredControllerState(
      openManagerAkahuSyncDialog(initialManagerAkahuSyncDialogState, [account]),
    )
  const inFlightRef = { current: false }
  let syncCalls = 0
  const runTransactionSync: RunManagerAkahuTransactionSync = ({ accounts }) => {
    syncCalls += 1
    expect(accounts).toEqual([account])
    return Promise.resolve(summaryFor(account))
  }
  expect(renderedState()._tag).toBe("confirming")

  startManagerAkahuSyncController({ inFlightRef, controllerState, runTransactionSync })
  startManagerAkahuSyncController({ inFlightRef, controllerState, runTransactionSync })

  expect(controllerState.stateRef.current._tag).toBe("running")
  expect(inFlightRef.current).toBe(true)
  expect(pendingStateCount()).toBe(1)
  expect(syncCalls).toBe(0)

  flushRenderedState()
  expect(renderedState()._tag).toBe("running")
  await flushSyncControllerPromises()

  expect(syncCalls).toBe(1)
  expect(inFlightRef.current).toBe(false)
  expect(controllerState.stateRef.current._tag).toBe("completed")
  flushRenderedState()
  expect(renderedState()._tag).toBe("completed")
})

it("does not enqueue running or launch sync from a deferred invalid start", async () => {
  const account = linkedAccount()
  const { controllerState, renderedState, flushRenderedState, pendingStateCount } =
    deferredControllerState(initialManagerAkahuSyncDialogState)
  const inFlightRef = { current: false }
  let syncCalls = 0
  const runTransactionSync: RunManagerAkahuTransactionSync = () => {
    syncCalls += 1
    return Promise.resolve(summaryFor(account))
  }

  startManagerAkahuSyncController({ inFlightRef, controllerState, runTransactionSync })
  await flushSyncControllerPromises()
  flushRenderedState()

  expect(syncCalls).toBe(0)
  expect(inFlightRef.current).toBe(false)
  expect(pendingStateCount()).toBe(0)
  expect(controllerState.stateRef.current._tag).toBe("closed")
  expect(renderedState()._tag).toBe("closed")
})

it("does not launch sync from a stale start callback after the dialog leaves confirming", async () => {
  const account = linkedAccount()
  const controllerState = immediateControllerState(
    openManagerAkahuSyncDialog(initialManagerAkahuSyncDialogState, [account]),
  )
  const inFlightRef = { current: false }
  let syncCalls = 0
  const runTransactionSync: RunManagerAkahuTransactionSync = () => {
    syncCalls += 1
    return Promise.resolve(summaryFor(account))
  }
  const staleStart = () => {
    startManagerAkahuSyncController({ inFlightRef, controllerState, runTransactionSync })
  }
  expect(controllerState.stateRef.current._tag).toBe("confirming")

  closeManagerAkahuSyncController(controllerState)
  staleStart()
  await flushSyncControllerPromises()

  expect(syncCalls).toBe(0)
  expect(inFlightRef.current).toBe(false)
  expect(controllerState.stateRef.current._tag).toBe("closed")
})

it("recovers from a synchronous sync runner throw and allows a later valid start", async () => {
  const account = linkedAccount()
  const controllerState = immediateControllerState(
    openManagerAkahuSyncDialog(initialManagerAkahuSyncDialogState, [account]),
  )
  const inFlightRef = { current: false }
  let syncCalls = 0
  const runTransactionSync: RunManagerAkahuTransactionSync = () => {
    syncCalls += 1
    if (syncCalls === 1) {
      throw new Error("sync runner failed before returning a promise")
    }
    return Promise.resolve(summaryFor(account))
  }

  startManagerAkahuSyncController({ inFlightRef, controllerState, runTransactionSync })
  expect(controllerState.stateRef.current._tag).toBe("running")
  expect(inFlightRef.current).toBe(true)
  await flushSyncControllerPromises()

  expect(syncCalls).toBe(1)
  expect(inFlightRef.current).toBe(false)
  expect(controllerState.stateRef.current).toEqual({
    _tag: "failed",
    accounts: [account],
    message: managerAkahuSyncFailureMessage,
  })

  controllerState.setState(openManagerAkahuSyncDialog(controllerState.stateRef.current, [account]))
  expect(controllerState.stateRef.current._tag).toBe("confirming")
  startManagerAkahuSyncController({ inFlightRef, controllerState, runTransactionSync })
  await flushSyncControllerPromises()

  expect(syncCalls).toBe(2)
  expect(inFlightRef.current).toBe(false)
  expect(controllerState.stateRef.current._tag).toBe("completed")
})

it("does not dismiss running sync state through controller close paths", () => {
  const account = linkedAccount()
  const controllerState = immediateControllerState({ _tag: "running", accounts: [account] })
  expect(controllerState.stateRef.current._tag).toBe("running")

  closeManagerAkahuSyncController(controllerState)
  closeManagerAkahuSyncController(controllerState)

  expect(controllerState.stateRef.current._tag).toBe("running")
})

it("keeps the running dialog open when the dialog primitive requests dismissal", () => {
  const account = linkedAccount()
  const runningState: ManagerAkahuSyncDialogState = { _tag: "running", accounts: [account] }

  expect(closeManagerAkahuSyncDialog(runningState)).toBe(runningState)
})

it("redacts credential-looking values before storing completed summary errors in UI state", async () => {
  const account = linkedAccount()
  const controllerState = immediateControllerState(
    openManagerAkahuSyncDialog(initialManagerAkahuSyncDialogState, [account]),
  )
  const inFlightRef = { current: false }
  const runTransactionSync: RunManagerAkahuTransactionSync = () =>
    Promise.resolve({
      accounts: [
        {
          account,
          counts: emptyManagerAkahuSyncSummaryCounts(),
          warnings: ["Akahu App Token: app-secret"],
          errors: ["Authorization: Bearer user-secret"],
        },
      ],
      overall: emptyManagerAkahuSyncSummaryCounts(),
    })

  startManagerAkahuSyncController({ inFlightRef, controllerState, runTransactionSync })
  await flushSyncControllerPromises()

  expect(controllerState.stateRef.current).toMatchObject({
    _tag: "completed",
    summary: {
      accounts: [
        {
          warnings: ["Akahu App Token: [redacted]"],
          errors: ["Authorization: [redacted]"],
        },
      ],
    },
  })
})

it("redacts credential-looking values in fallback dialog text", () => {
  expect(sanitizeManagerAkahuSyncDialogText("akahuUserToken=secret-value")).toBe(
    "akahuUserToken=[redacted]",
  )
})

it("exposes transfer-specific sync summary count labels", () => {
  expect(managerAkahuSyncSummaryCountLabels.transferRulesMatched).toBe("Transfer rules matched")
  expect(managerAkahuSyncSummaryCountLabels.transfersCreated).toBe("Transfers created")
  expect(managerAkahuSyncSummaryCountLabels.transfersUpdated).toBe("Transfers updated")
  expect(managerAkahuSyncSummaryCountLabels.transfersMerged).toBe("Transfers merged")
  expect(managerAkahuSyncSummaryCountLabels.stalePendingTransfersDetected).toBe(
    "Stale pending transfers detected",
  )
  expect(managerAkahuSyncSummaryRows.map((row) => row.key)).toContain("transfersMerged")
})
