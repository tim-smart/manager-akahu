import { Schema } from "effect"
import { expect, test } from "@effect/vitest"
import {
  AkahuTransactionDate,
  type AkahuTransactionDate as AkahuTransactionDateValue,
} from "../src/Akahu.ts"
import type { CalendarDate } from "../src/CalendarDate.ts"

const decodeAkahuDate = (date: string) => Schema.decodeSync(AkahuTransactionDate)(date)

test("decoded Akahu transaction date preserves the raw date and exposes a CalendarDate", () => {
  const date = decodeAkahuDate("2026-06-05T00:30:00.000+13:00")
  const calendarDate: CalendarDate = date.calendarDate

  expect(date.raw).toBe("2026-06-05T00:30:00.000+13:00")
  expect(calendarDate).toBe("2026-06-05")
  expect(Schema.encodeSync(AkahuTransactionDate)(date)).toBe("2026-06-05T00:30:00.000+13:00")
})

test("decoded Akahu transaction date is nominal", () => {
  // @ts-expect-error AkahuTransactionDate values must come from the domain decoder.
  const structuralDate: AkahuTransactionDateValue = {
    raw: "2026-06-05T00:30:00.000+13:00",
    calendarDate: "2026-06-05" as CalendarDate,
  }
  void structuralDate
})

test("decoded Akahu transaction date rejects malformed calendar components", () => {
  expect(() => decodeAkahuDate("2026-02-29T00:00:00.000Z")).toThrow()
  expect(() => decodeAkahuDate("2024-02-30T00:00:00.000Z")).toThrow()
  expect(() => decodeAkahuDate("2026-13-01T00:00:00.000Z")).toThrow()
})
