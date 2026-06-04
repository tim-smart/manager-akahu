import { Schema } from "effect"
import { Account } from "../Akahu.ts"

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
