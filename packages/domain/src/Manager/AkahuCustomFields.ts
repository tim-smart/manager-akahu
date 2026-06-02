import { Schema } from "effect"

export class AkahuCustomFields extends Schema.Class<AkahuCustomFields>("AkahuCustomFields")({
  akahuAppToken: Schema.RedactedFromValue(Schema.NonEmptyString),
  akahuUserToken: Schema.RedactedFromValue(Schema.NonEmptyString),
}) {}
