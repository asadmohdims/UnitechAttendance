// The amount keypad: whole rupees, at most 7 digits (9,999,999 is plenty for a cash payment).

export const MAX_DIGITS = 7

export function pressAmountDigit(digits: string, digit: string): string {
  if (digits.length >= MAX_DIGITS) return digits
  if (digits === '' && digit === '0') return digits // no leading zeros
  return digits + digit
}

export const backspaceAmount = (digits: string) => digits.slice(0, -1)

/** "1500" -> "1,500"; Indian grouping puts the next comma after two digits: "1234567" -> "12,34,567". */
export const groupAmount = (digits: string) => Number(digits || '0').toLocaleString('en-IN')
