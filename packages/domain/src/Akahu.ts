import { Effect, type Brand, DateTime, Option, Schema, SchemaGetter, SchemaIssue } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { type CalendarDate, parseCalendarDate } from "./CalendarDate.ts"
import { BigDecimalFromNumber } from "./shared.ts"

export class Merchant extends Schema.Class<Merchant>("akahu/Merchant")({
  name: Schema.String,
}) {}

export class Category extends Schema.Class<Category>("akahu/Category")({
  _id: Schema.String,
  name: Schema.String,
}) {}

export const ConnectionId: Schema.refine<
  string & Brand.Brand<"akahu/ConnectionId">,
  Schema.String
> = Schema.String.pipe(Schema.brand("akahu/ConnectionId"))

export const AccountId = Schema.String.pipe(Schema.brand("akahu/AccountId"))
export type AccountId = typeof AccountId.Type

export const UserId = Schema.String.pipe(Schema.brand("akahu/UserId"))
export type UserId = typeof UserId.Type

const leadingCalendarDate = /^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/

const invalidAkahuTransactionDateIssue = (raw: string) =>
  new SchemaIssue.InvalidValue(Option.some(raw), {
    message: "Akahu transaction date must start with a valid yyyy-mm-dd calendar date",
  })

const getLeadingAkahuCalendarDate = (value: string): CalendarDate | undefined => {
  const match = leadingCalendarDate.exec(value)
  const calendarDate = match?.[1]
  if (calendarDate === undefined) {
    return undefined
  }

  return parseCalendarDate(calendarDate)?.date
}

const parseAkahuTransactionDate = (
  raw: string,
): { readonly raw: string; readonly calendarDate: CalendarDate } | undefined => {
  const calendarDate = getLeadingAkahuCalendarDate(raw)
  return calendarDate === undefined ? undefined : { raw, calendarDate }
}

class AkahuTransactionDateValue extends Schema.Class<AkahuTransactionDateValue>(
  "akahu/TransactionDate",
)({
  raw: Schema.String,
  calendarDate: Schema.String,
}) {
  declare readonly calendarDate: CalendarDate
  declare private readonly AkahuTransactionDateNominal: void
}

export const AkahuTransactionDate = Schema.String.pipe(
  Schema.decodeTo(AkahuTransactionDateValue, {
    decode: SchemaGetter.transformOrFail((raw) => {
      const date = parseAkahuTransactionDate(raw)
      return date === undefined
        ? Effect.fail(invalidAkahuTransactionDateIssue(raw))
        : Effect.succeed(new AkahuTransactionDateValue(date))
    }),
    encode: SchemaGetter.transform((date) => date.raw),
  }),
)
export type AkahuTransactionDate = typeof AkahuTransactionDate.Type

export class Transaction extends Schema.Class<Transaction>("akahu/Transaction")({
  _id: Schema.String,
  _account: AccountId,
  _user: UserId,
  _connection: ConnectionId,
  date: AkahuTransactionDate,
  description: Schema.String,
  amount: BigDecimalFromNumber,
  merchant: Schema.optional(Merchant),
  category: Schema.optional(Category),
}) {}

class Cursor extends Schema.Class<Cursor>("akahu/Cursor")({
  next: Schema.NullOr(Schema.String),
}) {}

export class PendingTransaction extends Schema.Class<PendingTransaction>(
  "akahu/PendingTransaction",
)({
  _user: UserId,
  _account: AccountId,
  _connection: ConnectionId,
  date: AkahuTransactionDate,
  description: Schema.String,
  amount: BigDecimalFromNumber,
}) {}

const OptionalDateTimeUtc = Schema.optional(Schema.DateTimeUtcFromString).pipe(
  Schema.decodeTo(Schema.DateTimeUtc, {
    decode: SchemaGetter.withDefault(DateTime.now),
    encode: SchemaGetter.passthrough(),
  }),
)

class Refreshed extends Schema.Class<Refreshed>("akahu/Refreshed")({
  meta: Schema.DateTimeUtcFromString,
  transactions: OptionalDateTimeUtc,
  party: OptionalDateTimeUtc,
}) {}

export class Account extends Schema.Class<Account>("akahu/AccountElement")({
  _id: AccountId,
  name: Schema.String,
  refreshed: Refreshed,
}) {}

export interface PaginatedResponse<A> {
  readonly success: boolean
  readonly items: ReadonlyArray<A>
  readonly cursor?: Cursor | undefined
}

export const PaginatedResponse = <S extends Schema.Top>(schema: S) =>
  Schema.Struct({
    success: Schema.Boolean,
    items: Schema.Array(schema),
    cursor: Schema.optional(Cursor),
  })

export const AkahuApi = HttpApi.make("akahu").add(
  HttpApiGroup.make("transactions").add(
    HttpApiEndpoint.get("list", "/accounts/:accountId/transactions", {
      params: {
        accountId: AccountId,
      },
      query: {
        cursor: Schema.optional(Schema.String),
      },
      success: PaginatedResponse(Transaction),
    }),
    HttpApiEndpoint.get("pending", "/accounts/:accountId/transactions/pending", {
      params: {
        accountId: AccountId,
      },
      query: {
        amount_as_number: Schema.Literal("true"),
        cursor: Schema.optional(Schema.String),
      },
      success: PaginatedResponse(PendingTransaction),
    }),
    HttpApiEndpoint.post("refresh", "/refresh", {
      success: Schema.Struct({
        success: Schema.Boolean,
      }).annotate({
        httpApiStatus: 200,
      }),
    }),
  ),
  HttpApiGroup.make("accounts").add(
    HttpApiEndpoint.get("list", "/accounts", {
      query: {
        cursor: Schema.optional(Schema.String),
      },
      success: PaginatedResponse(Account),
    }),
  ),
)
