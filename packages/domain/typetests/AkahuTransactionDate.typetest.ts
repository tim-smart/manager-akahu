import type { AkahuTransactionDate } from "../src/Akahu.ts"
import type { CalendarDate } from "../src/CalendarDate.ts"

type AssertTrue<T extends true> = T

type StructuralAkahuTransactionDate = {
  readonly raw: string
  readonly calendarDate: CalendarDate
}

export type StructuralAkahuTransactionDateIsRejected = AssertTrue<
  StructuralAkahuTransactionDate extends AkahuTransactionDate ? false : true
>
