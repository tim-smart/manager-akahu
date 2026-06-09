import { Schema } from "effect"
import { Account } from "../Akahu.ts"

export class AkahuTransferRule extends Schema.Class<AkahuTransferRule>("AkahuTransferRule")({
  keyword: Schema.String,
  normalizedKeyword: Schema.String,
  destinationAccountKey: Schema.String,
}) {}

export const AkahuTransferRuleInvalidReason = Schema.Literals([
  "missingComma",
  "blankKeyword",
  "blankDestinationAccountKey",
])
export type AkahuTransferRuleInvalidReason = typeof AkahuTransferRuleInvalidReason.Type

export class AkahuTransferRuleInvalidLine extends Schema.Class<AkahuTransferRuleInvalidLine>(
  "AkahuTransferRuleInvalidLine",
)({
  lineNumber: Schema.Number,
  line: Schema.String,
  reason: AkahuTransferRuleInvalidReason,
}) {}

export class AkahuTransferRuleParseResult extends Schema.Class<AkahuTransferRuleParseResult>(
  "AkahuTransferRuleParseResult",
)({
  rules: Schema.Array(AkahuTransferRule),
  invalidLines: Schema.Array(AkahuTransferRuleInvalidLine),
}) {}

export const normalizeAkahuTransferRuleText = (text: string): string =>
  text.trim().toLowerCase().replace(/\s+/g, " ")

export const parseAkahuTransferRules = (input: string): AkahuTransferRuleParseResult => {
  const rules: Array<AkahuTransferRule> = []
  const invalidLines: Array<AkahuTransferRuleInvalidLine> = []
  const seenRuleKeys = new Set<string>()

  for (const [lineIndex, line] of input.split(/\r\n|\n|\r/).entries()) {
    if (line.trim() === "") {
      continue
    }

    const commaIndex = line.indexOf(",")
    if (commaIndex < 0) {
      invalidLines.push(
        new AkahuTransferRuleInvalidLine({
          lineNumber: lineIndex + 1,
          line,
          reason: "missingComma",
        }),
      )
      continue
    }

    const keyword = line.slice(0, commaIndex).trim()
    const destinationAccountKey = line.slice(commaIndex + 1).trim()
    if (keyword === "") {
      invalidLines.push(
        new AkahuTransferRuleInvalidLine({
          lineNumber: lineIndex + 1,
          line,
          reason: "blankKeyword",
        }),
      )
      continue
    }
    if (destinationAccountKey === "") {
      invalidLines.push(
        new AkahuTransferRuleInvalidLine({
          lineNumber: lineIndex + 1,
          line,
          reason: "blankDestinationAccountKey",
        }),
      )
      continue
    }

    const normalizedKeyword = normalizeAkahuTransferRuleText(keyword)
    const ruleKey = `${normalizedKeyword}\u0000${destinationAccountKey}`
    if (seenRuleKeys.has(ruleKey)) {
      continue
    }
    seenRuleKeys.add(ruleKey)
    rules.push(
      new AkahuTransferRule({
        keyword,
        normalizedKeyword,
        destinationAccountKey,
      }),
    )
  }

  return new AkahuTransferRuleParseResult({ rules, invalidLines })
}

export const matchesAkahuTransferRuleDescription = (
  rule: AkahuTransferRule,
  description: string,
): boolean => normalizeAkahuTransferRuleText(description).includes(rule.normalizedKeyword)

export class LinkedAccount extends Schema.Class<LinkedAccount>("LinkedAccount")({
  key: Schema.String,
  name: Schema.String,
  currency: Schema.NullOr(Schema.String),
  canHavePendingTransactions: Schema.Boolean,
  akahuAccount: Account,
}) {}

export class StaleLinkedAccountSelection extends Schema.Class<StaleLinkedAccountSelection>(
  "StaleLinkedAccountSelection",
)({
  key: Schema.String,
  name: Schema.String,
  currency: Schema.NullOr(Schema.String),
  canHavePendingTransactions: Schema.Boolean,
  selectedAkahuAccountId: Schema.String,
  selectedAkahuAccountLabel: Schema.NullOr(Schema.String),
}) {}

export class ManagerAkahuSetupLoading extends Schema.TaggedClass<ManagerAkahuSetupLoading>()(
  "loading",
  {},
) {}

export const AkahuCredentialFieldName = Schema.Literals(["Akahu App Token", "Akahu User Token"])
export type AkahuCredentialFieldName = typeof AkahuCredentialFieldName.Type

export class ManagerAkahuSetupMissingCredentials extends Schema.TaggedClass<ManagerAkahuSetupMissingCredentials>()(
  "missingCredentials",
  {
    missingFieldNames: Schema.Array(AkahuCredentialFieldName),
  },
) {}

export class ManagerAkahuSetupInvalidCredentials extends Schema.TaggedClass<ManagerAkahuSetupInvalidCredentials>()(
  "invalidCredentials",
  {},
) {}

export class ManagerAkahuSetupNoAkahuAccounts extends Schema.TaggedClass<ManagerAkahuSetupNoAkahuAccounts>()(
  "noAkahuAccounts",
  {
    staleSelections: Schema.Array(StaleLinkedAccountSelection),
  },
) {}

export class ManagerAkahuSetupNoLinkedManagerAccounts extends Schema.TaggedClass<ManagerAkahuSetupNoLinkedManagerAccounts>()(
  "noLinkedManagerAccounts",
  {
    staleSelections: Schema.Array(StaleLinkedAccountSelection),
  },
) {}

export class ManagerAkahuSetupReady extends Schema.TaggedClass<ManagerAkahuSetupReady>()("ready", {
  accounts: Schema.Array(LinkedAccount),
  staleSelections: Schema.Array(StaleLinkedAccountSelection),
}) {}

export class ManagerAkahuSetupError extends Schema.TaggedClass<ManagerAkahuSetupError>()("error", {
  message: Schema.String,
}) {}

export const ManagerAkahuSetupState = Schema.Union([
  ManagerAkahuSetupLoading,
  ManagerAkahuSetupMissingCredentials,
  ManagerAkahuSetupInvalidCredentials,
  ManagerAkahuSetupNoAkahuAccounts,
  ManagerAkahuSetupNoLinkedManagerAccounts,
  ManagerAkahuSetupReady,
  ManagerAkahuSetupError,
])
export type ManagerAkahuSetupState = typeof ManagerAkahuSetupState.Type

export const makeManagerAkahuSetupState = (options: {
  readonly akahuAccountCount: number
  readonly linkedAccounts: ReadonlyArray<LinkedAccount>
  readonly staleSelections: ReadonlyArray<StaleLinkedAccountSelection>
}): ManagerAkahuSetupState => {
  if (options.akahuAccountCount === 0) {
    return new ManagerAkahuSetupNoAkahuAccounts({
      staleSelections: [...options.staleSelections],
    })
  }
  if (options.linkedAccounts.length === 0) {
    return new ManagerAkahuSetupNoLinkedManagerAccounts({
      staleSelections: [...options.staleSelections],
    })
  }
  return new ManagerAkahuSetupReady({
    accounts: [...options.linkedAccounts],
    staleSelections: [...options.staleSelections],
  })
}

export class AkahuCustomFields extends Schema.Class<AkahuCustomFields>("AkahuCustomFields")({
  akahuAppToken: Schema.RedactedFromValue(Schema.NonEmptyString),
  akahuUserToken: Schema.RedactedFromValue(Schema.NonEmptyString),
  accounts: Schema.Array(LinkedAccount),
}) {}

export class AkahuTokens extends Schema.Class<AkahuTokens>("AkahuTokens")({
  akahuAppToken: Schema.RedactedFromValue(Schema.NonEmptyString),
  akahuUserToken: Schema.RedactedFromValue(Schema.NonEmptyString),
}) {}
