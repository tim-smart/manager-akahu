import { BigDecimal, Schema, SchemaGetter } from "effect"

export const BigDecimalFromNumber = Schema.Number.pipe(
  Schema.decodeTo(Schema.BigDecimal, {
    decode: SchemaGetter.transform(BigDecimal.fromNumberUnsafe),
    encode: SchemaGetter.transform(BigDecimal.toNumberUnsafe),
  }),
)
