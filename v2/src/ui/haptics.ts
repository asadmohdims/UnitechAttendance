// navigator.vibrate exists on Android/Chrome only; everywhere else these are silent no-ops.
export const hapticSuccess = () => navigator.vibrate?.(20)
export const hapticError = () => navigator.vibrate?.([30, 40, 30])
