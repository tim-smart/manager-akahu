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

export type ManagerAkahuTransferRuleAccountMetadata = {
  readonly key: string
  readonly name: string
  readonly currency: string | null
  readonly canHavePendingTransactions: boolean
}

export class LinkedAccountTransferRule extends Schema.Class<LinkedAccountTransferRule>(
  "LinkedAccountTransferRule",
)({
  sourceAccountKey: Schema.String,
  sourceAccountName: Schema.String,
  sourceAccountCurrency: Schema.NullOr(Schema.String),
  sourceAccountCanHavePendingTransactions: Schema.Boolean,
  keyword: Schema.String,
  normalizedKeyword: Schema.String,
  destinationAccountKey: Schema.String,
  destinationAccountName: Schema.String,
  destinationAccountCurrency: Schema.NullOr(Schema.String),
  destinationAccountCanHavePendingTransactions: Schema.Boolean,
}) {}

export const buildLinkedAccountTransferRules = (options: {
  readonly sourceAccount: ManagerAkahuTransferRuleAccountMetadata
  readonly rawValue: unknown
  readonly managerAccountsByKey: ReadonlyMap<string, ManagerAkahuTransferRuleAccountMetadata>
}) => {
  if (typeof options.rawValue !== "string" || options.rawValue.trim() === "") {
    return { rules: [], warnings: [] } as const
  }

  const parsed = parseAkahuTransferRules(options.rawValue)
  const rules: Array<LinkedAccountTransferRule> = []
  const warnings = parsed.invalidLines.map((line) =>
    formatTransferRuleSyntaxWarning(line.reason, line.lineNumber),
  )
  const seenRuleKeys = new Set<string>()

  for (const rule of parsed.rules) {
    const ruleKey = `${rule.normalizedKeyword}\u0000${rule.destinationAccountKey}`
    if (seenRuleKeys.has(ruleKey)) {
      continue
    }
    seenRuleKeys.add(ruleKey)

    if (rule.destinationAccountKey === options.sourceAccount.key) {
      warnings.push(
        `Transfer rule "${rule.keyword}" targets its own Manager bank/cash account and was skipped.`,
      )
      continue
    }

    const destinationAccount = options.managerAccountsByKey.get(rule.destinationAccountKey)
    if (!destinationAccount) {
      warnings.push(
        `Transfer rule "${rule.keyword}" targets unknown Manager bank/cash account key ${rule.destinationAccountKey} and was skipped.`,
      )
      continue
    }

    rules.push(
      new LinkedAccountTransferRule({
        sourceAccountKey: options.sourceAccount.key,
        sourceAccountName: options.sourceAccount.name,
        sourceAccountCurrency: options.sourceAccount.currency,
        sourceAccountCanHavePendingTransactions: options.sourceAccount.canHavePendingTransactions,
        keyword: rule.keyword,
        normalizedKeyword: rule.normalizedKeyword,
        destinationAccountKey: destinationAccount.key,
        destinationAccountName: destinationAccount.name,
        destinationAccountCurrency: destinationAccount.currency,
        destinationAccountCanHavePendingTransactions: destinationAccount.canHavePendingTransactions,
      }),
    )
  }

  return { rules, warnings } as const
}

const formatTransferRuleSyntaxWarning = (reason: string, lineNumber: number) => {
  switch (reason) {
    case "missingComma":
      return `Transfer rule line ${lineNumber} must use keyword,destination account key and was skipped.`
    case "blankKeyword":
      return `Transfer rule line ${lineNumber} has a blank keyword and was skipped.`
    case "blankDestinationAccountKey":
      return `Transfer rule line ${lineNumber} has a blank destination account key and was skipped.`
    default:
      return `Transfer rule line ${lineNumber} is invalid and was skipped.`
  }
}

export class LinkedAccount extends Schema.Class<LinkedAccount>("LinkedAccount")({
  key: Schema.String,
  name: Schema.String,
  currency: Schema.NullOr(Schema.String),
  canHavePendingTransactions: Schema.Boolean,
  akahuAccount: Account,
  transferRules: Schema.Array(LinkedAccountTransferRule),
  transferRuleWarnings: Schema.Array(Schema.String),
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
