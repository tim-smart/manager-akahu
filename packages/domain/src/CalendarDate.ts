const exactCalendarDate = /^(\d{4})-(\d{2})-(\d{2})$/

export interface CalendarDateParts {
  readonly date: string
  readonly year: number
  readonly month: number
  readonly day: number
}

const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)

export const parseCalendarDate = (date: string): CalendarDateParts | undefined => {
  const match = exactCalendarDate.exec(date)
  if (match === null) {
    return undefined
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12) {
    return undefined
  }

  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (day < 1 || day > daysInMonth[month - 1]) {
    return undefined
  }

  return { date, year, month, day }
}
