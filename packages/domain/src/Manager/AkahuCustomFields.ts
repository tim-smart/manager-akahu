import { Schema } from "effect"
import { Account } from "../Akahu.ts"

export class LinkedAccount extends Schema.Class<LinkedAccount>("LinkedAccount")({
  key: Schema.String,
  name: Schema.String,
  akahuAccount: Account,
}) {}

export class AkahuCustomFields extends Schema.Class<AkahuCustomFields>("AkahuCustomFields")({
  akahuAppToken: Schema.RedactedFromValue(Schema.NonEmptyString),
  akahuUserToken: Schema.RedactedFromValue(Schema.NonEmptyString),
  accounts: Schema.Array(LinkedAccount),
}) {}

export class AkahuTokens extends Schema.Class<AkahuTokens>("AkahuTokens")({
  akahuAppToken: Schema.RedactedFromValue(Schema.NonEmptyString),
  akahuUserToken: Schema.RedactedFromValue(Schema.NonEmptyString),
}) {}
