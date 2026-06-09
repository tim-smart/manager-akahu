import { expect, it, test } from "@effect/vitest"
import { DateTime, Effect } from "effect"
import { Account, type AccountId } from "@app/domain/Akahu"
import { makeManagerAkahuSetupState } from "@app/domain/Manager/AkahuCustomFields"
import { AkahuRpcError } from "@app/domain/rpc"
import type { Client, ItemOfTextCustomField, TextCustomField } from "@app/manager-api/ManagerClient"
import {
  collectManagerAkahuAccountSelections,
  ensureManagerBankOrCashAccountTextField,
  isManagerAkahuTransferRulesFieldCurrent,
  managerAkahuAccountFieldName,
  managerAkahuTransferRulesFieldDescription,
  managerAkahuTransferRulesFieldName,
  mapAkahuAccountsReadFailure,
} from "../src/Manager/Flows.ts"

const managerBankOrCashAccountPlacement = ["1408c33b-6284-4f50-9e31-48cbea21f3cf"] as const
const managerBusinessPlacement = ["38cf4712-6e95-4ce1-b53a-bff03edad273"] as const
const akahuStartDateFieldKey = "akahu-start-date-field"

const akahuChecking = new Account({
  _id: "akahu-checking" as AccountId,
  name: "Akahu Checking",
  refreshed: {
    meta: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
    transactions: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
    party: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
  },
})

const makeTextCustomField = (key: string, item: TextCustomField): ItemOfTextCustomField => ({
  key,
  item,
  _links: null,
  _actions: null,
})

const makeTextCustomFieldEnsureHarness = (initialFields: ReadonlyArray<ItemOfTextCustomField>) => {
  let fields = [...initialFields]
  const postPayloads: Array<TextCustomField> = []
  const putPayloads: Array<{
    readonly key?: string | undefined
    readonly value?: TextCustomField
  }> = []
  const client: Pick<Client, "POST/api4/text-custom-field" | "PUT/api4/text-custom-field"> = {
    "POST/api4/text-custom-field": (payload) => {
      const value = payload.value ?? {}
      postPayloads.push(value)
      fields = [...fields, makeTextCustomField(`created-field-${postPayloads.length}`, value)]
      return Effect.succeed(true)
    },
    "PUT/api4/text-custom-field": (payload) => {
      putPayloads.push({ key: payload.key, value: payload.value })
      fields = fields.map((field) =>
        field.key === payload.key ? makeTextCustomField(field.key, payload.value ?? {}) : field,
      )
      return Effect.succeed(true)
    },
  }

  return {
    ensure: (options: {
      readonly name: string
      readonly type: number
      readonly placement: ReadonlyArray<string>
      readonly description?: string | undefined
      readonly optionsForDropdownList?: ReadonlyArray<string> | undefined
    }) =>
      ensureManagerBankOrCashAccountTextField({
        client,
        getCurrentFields: () => Effect.succeed(fields),
        refreshFields: () => Effect.void,
        ...options,
      }),
    postPayloads,
    putPayloads,
  }
}

test("collects linked Manager accounts with sync setup metadata", () => {
  const selections = collectManagerAkahuAccountSelections({
    accountFieldKey: "akahu-field",
    transferRulesFieldKey: "transfer-rules-field",
    akahuStartDateFieldKey,
    akahuAccounts: [akahuChecking],
    managerAccounts: [
      {
        key: "manager-checking",
        item: {
          name: "Manager Checking",
          currency: "NZD",
          canHavePendingTransactions: true,
          customFields2: {
            strings: {
              "akahu-field": "Akahu Checking - akahu-checking",
            },
          },
        },
      },
    ],
  })

  expect(selections.staleSelections).toEqual([])
  expect(selections.linkedAccounts).toMatchObject([
    {
      key: "manager-checking",
      name: "Manager Checking",
      currency: "NZD",
      canHavePendingTransactions: true,
      akahuAccount: akahuChecking,
      transferRules: [],
      transferRuleWarnings: [],
    },
  ])
})

test("collects stale Manager Akahu account selections separately", () => {
  const selections = collectManagerAkahuAccountSelections({
    accountFieldKey: "akahu-field",
    transferRulesFieldKey: "transfer-rules-field",
    akahuStartDateFieldKey,
    akahuAccounts: [akahuChecking],
    managerAccounts: [
      {
        key: "manager-stale",
        item: {
          name: "Old Savings",
          canHavePendingTransactions: false,
          customFields2: {
            strings: {
              "akahu-field": "Closed Savings - akahu-closed",
            },
          },
        },
      },
    ],
  })

  expect(selections.linkedAccounts).toEqual([])
  expect(selections.staleSelections).toMatchObject([
    {
      key: "manager-stale",
      name: "Old Savings",
      currency: null,
      canHavePendingTransactions: false,
      selectedAkahuAccountId: "akahu-closed",
      selectedAkahuAccountLabel: "Closed Savings",
    },
  ])
})

test("classifies setup state from Akahu account and Manager link availability", () => {
  const staleSelections = collectManagerAkahuAccountSelections({
    accountFieldKey: "akahu-field",
    transferRulesFieldKey: "transfer-rules-field",
    akahuStartDateFieldKey,
    akahuAccounts: [akahuChecking],
    managerAccounts: [
      {
        key: "manager-stale",
        item: {
          customFields2: {
            strings: {
              "akahu-field": "Closed Savings - akahu-closed",
            },
          },
        },
      },
    ],
  }).staleSelections

  expect(
    makeManagerAkahuSetupState({
      akahuAccountCount: 0,
      linkedAccounts: [],
      staleSelections,
    })._tag,
  ).toBe("noAkahuAccounts")

  expect(
    makeManagerAkahuSetupState({
      akahuAccountCount: 1,
      linkedAccounts: [],
      staleSelections,
    })._tag,
  ).toBe("noLinkedManagerAccounts")

  const ready = makeManagerAkahuSetupState({
    akahuAccountCount: 1,
    linkedAccounts: [
      ...collectManagerAkahuAccountSelections({
        accountFieldKey: "akahu-field",
        transferRulesFieldKey: "transfer-rules-field",
        akahuStartDateFieldKey,
        akahuAccounts: [akahuChecking],
        managerAccounts: [
          {
            key: "manager-checking",
            item: {
              customFields2: {
                strings: {
                  "akahu-field": "Akahu Checking - akahu-checking",
                },
              },
            },
          },
        ],
      }).linkedAccounts,
    ],
    staleSelections,
  })

  expect(ready._tag).toBe("ready")
  if (ready._tag === "ready") {
    expect(ready.staleSelections).toHaveLength(1)
  }
})

test("parses linked-account transfer rules and non-blocking warnings", () => {
  const selections = collectManagerAkahuAccountSelections({
    accountFieldKey: "akahu-field",
    transferRulesFieldKey: "transfer-rules-field",
    akahuStartDateFieldKey,
    akahuAccounts: [akahuChecking],
    managerAccounts: [
      {
        key: "manager-checking",
        item: {
          name: "Manager Checking",
          currency: null,
          canHavePendingTransactions: true,
          customFields2: {
            strings: {
              "akahu-field": "Akahu Checking - akahu-checking",
              "transfer-rules-field":
                "Coffee,manager-savings\nmissing comma\nRent,manager-missing\nSelf,manager-checking",
            },
          },
        },
      },
      {
        key: "manager-savings",
        item: {
          name: "Manager Savings",
          currency: "NZD",
          canHavePendingTransactions: false,
        },
      },
    ],
  })

  expect(selections.staleSelections).toEqual([])
  expect(selections.linkedAccounts).toHaveLength(1)
  expect(selections.linkedAccounts[0].transferRules).toMatchObject([
    {
      sourceAccountKey: "manager-checking",
      sourceAccountName: "Manager Checking",
      sourceAccountCurrency: null,
      sourceAccountCanHavePendingTransactions: true,
      keyword: "Coffee",
      normalizedKeyword: "coffee",
      destinationAccountKey: "manager-savings",
      destinationAccountName: "Manager Savings",
      destinationAccountCurrency: "NZD",
      destinationAccountCanHavePendingTransactions: false,
    },
  ])
  expect(selections.linkedAccounts[0].transferRuleWarnings).toEqual([
    "Transfer rule line 2 must use keyword,destination account key and was skipped.",
    'Transfer rule "Rent" targets unknown Manager bank/cash account key manager-missing and was skipped.',
    'Transfer rule "Self" targets its own Manager bank/cash account and was skipped.',
  ])
})

test("recognizes current multiline Manager bank/cash transfer-rule fields", () => {
  expect(
    isManagerAkahuTransferRulesFieldCurrent({
      type: 1,
      placement: ["1408c33b-6284-4f50-9e31-48cbea21f3cf"],
    }),
  ).toBe(true)
  expect(
    isManagerAkahuTransferRulesFieldCurrent({
      type: 2,
      placement: ["1408c33b-6284-4f50-9e31-48cbea21f3cf"],
    }),
  ).toBe(false)
  expect(isManagerAkahuTransferRulesFieldCurrent({ type: 1, placement: [] })).toBe(false)
})

it.effect("creates missing Akahu Transfer Rules as a multiline bank/cash account field", () =>
  Effect.gen(function* () {
    const harness = makeTextCustomFieldEnsureHarness([])

    const field = yield* harness.ensure({
      name: managerAkahuTransferRulesFieldName,
      description: managerAkahuTransferRulesFieldDescription,
      type: 1,
      placement: managerBankOrCashAccountPlacement,
    })

    expect(field.key).toBe("created-field-1")
    expect(harness.postPayloads).toEqual([
      {
        name: managerAkahuTransferRulesFieldName,
        description: managerAkahuTransferRulesFieldDescription,
        type: 1,
        placement: [...managerBankOrCashAccountPlacement],
        excludeFromCopyingOrCloning: true,
        size: 2,
      },
    ])
    expect(harness.putPayloads).toEqual([])
  }),
)

it.effect("repairs wrong-type transfer-rule fields without carrying dropdown options", () =>
  Effect.gen(function* () {
    const harness = makeTextCustomFieldEnsureHarness([
      makeTextCustomField("transfer-rules-field", {
        name: managerAkahuTransferRulesFieldName,
        type: 2,
        placement: [...managerBankOrCashAccountPlacement],
        optionsForDropdownList: "Old Akahu - old-akahu",
        description: "existing Manager field metadata",
      }),
    ])
    const managerCheckingAccount = {
      key: "manager-checking",
      item: {
        name: "Manager Checking",
        customFields2: {
          strings: {
            "akahu-field": "Akahu Checking - akahu-checking",
            "transfer-rules-field": "Coffee,manager-savings",
          },
        },
      },
    }
    const managerAccounts = [
      managerCheckingAccount,
      { key: "manager-savings", item: { name: "Manager Savings" } },
    ]

    const field = yield* harness.ensure({
      name: managerAkahuTransferRulesFieldName,
      description: managerAkahuTransferRulesFieldDescription,
      type: 1,
      placement: managerBankOrCashAccountPlacement,
    })

    expect(field.key).toBe("transfer-rules-field")
    expect(harness.putPayloads).toEqual([
      {
        key: "transfer-rules-field",
        value: {
          name: managerAkahuTransferRulesFieldName,
          description: managerAkahuTransferRulesFieldDescription,
          type: 1,
          placement: [...managerBankOrCashAccountPlacement],
          excludeFromCopyingOrCloning: true,
          size: 2,
        },
      },
    ])
    expect(managerCheckingAccount.item.customFields2.strings["transfer-rules-field"]).toBe(
      "Coffee,manager-savings",
    )
    expect(
      collectManagerAkahuAccountSelections({
        accountFieldKey: "akahu-field",
        transferRulesFieldKey: field.key,
        akahuStartDateFieldKey,
        akahuAccounts: [akahuChecking],
        managerAccounts,
      }).linkedAccounts[0]?.transferRules,
    ).toMatchObject([{ keyword: "Coffee", destinationAccountKey: "manager-savings" }])
  }),
)

it.effect("repairs wrong-placement transfer-rule fields in place", () =>
  Effect.gen(function* () {
    const harness = makeTextCustomFieldEnsureHarness([
      makeTextCustomField("transfer-rules-field", {
        name: managerAkahuTransferRulesFieldName,
        type: 1,
        placement: [...managerBusinessPlacement],
      }),
    ])

    const field = yield* harness.ensure({
      name: managerAkahuTransferRulesFieldName,
      description: managerAkahuTransferRulesFieldDescription,
      type: 1,
      placement: managerBankOrCashAccountPlacement,
    })

    expect(field.key).toBe("transfer-rules-field")
    expect(harness.putPayloads).toEqual([
      {
        key: "transfer-rules-field",
        value: {
          name: managerAkahuTransferRulesFieldName,
          description: managerAkahuTransferRulesFieldDescription,
          type: 1,
          placement: [...managerBankOrCashAccountPlacement],
          excludeFromCopyingOrCloning: true,
          size: 2,
        },
      },
    ])
  }),
)

it.effect("adds the transfer-rule description to otherwise current fields", () =>
  Effect.gen(function* () {
    const harness = makeTextCustomFieldEnsureHarness([
      makeTextCustomField("transfer-rules-field", {
        name: managerAkahuTransferRulesFieldName,
        type: 1,
        placement: [...managerBankOrCashAccountPlacement],
      }),
    ])

    const field = yield* harness.ensure({
      name: managerAkahuTransferRulesFieldName,
      description: managerAkahuTransferRulesFieldDescription,
      type: 1,
      placement: managerBankOrCashAccountPlacement,
    })

    expect(field.key).toBe("transfer-rules-field")
    expect(harness.putPayloads).toEqual([
      {
        key: "transfer-rules-field",
        value: {
          name: managerAkahuTransferRulesFieldName,
          description: managerAkahuTransferRulesFieldDescription,
          type: 1,
          placement: [...managerBankOrCashAccountPlacement],
          excludeFromCopyingOrCloning: true,
          size: 2,
        },
      },
    ])
  }),
)

it.effect("keeps Akahu Account dropdown option refresh behavior", () =>
  Effect.gen(function* () {
    const harness = makeTextCustomFieldEnsureHarness([
      makeTextCustomField("akahu-field", {
        name: managerAkahuAccountFieldName,
        type: 2,
        placement: [...managerBankOrCashAccountPlacement],
        optionsForDropdownList: "Old Checking - old-checking",
      }),
    ])

    const field = yield* harness.ensure({
      name: managerAkahuAccountFieldName,
      type: 2,
      placement: managerBankOrCashAccountPlacement,
      optionsForDropdownList: ["Akahu Checking - akahu-checking"],
    })

    expect(field.key).toBe("akahu-field")
    expect(harness.postPayloads).toEqual([])
    expect(harness.putPayloads).toEqual([
      {
        key: "akahu-field",
        value: {
          name: managerAkahuAccountFieldName,
          type: 2,
          placement: [...managerBankOrCashAccountPlacement],
          optionsForDropdownList: "Akahu Checking - akahu-checking",
          excludeFromCopyingOrCloning: true,
          size: 2,
        },
      },
    ])
  }),
)

test("maps typed Akahu authentication failures to invalid credentials", () => {
  expect(
    mapAkahuAccountsReadFailure(new AkahuRpcError({ reason: "authentication", status: 401 }))._tag,
  ).toBe("invalidCredentials")

  expect(
    mapAkahuAccountsReadFailure(new AkahuRpcError({ reason: "authorization", status: 403 }))._tag,
  ).toBe("invalidCredentials")
})

test("maps typed retryable Akahu read failures to setup error", () => {
  const state = mapAkahuAccountsReadFailure(new AkahuRpcError({ reason: "read", status: 500 }))

  expect(state._tag).toBe("error")
  if (state._tag === "error") {
    expect(state.message).toBe(
      "Akahu accounts could not be loaded. Check the Akahu connection and try again.",
    )
  }
})
