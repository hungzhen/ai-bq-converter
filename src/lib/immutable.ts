/**
 * Helpers that make records unchangeable once created.
 *
 * Why: an original BQ record must never be changed by anything else in the program — in
 * particular not by a progress claim. Records are therefore stored as frozen copies:
 *  - `structuredClone` makes an independent copy, so no other object shares its insides;
 *  - `Object.freeze` (applied at every level) makes any attempt to change it fail.
 * Changes are made by creating a NEW record from the old one, so the old one stays as it was.
 */

/** Freezes an object and everything inside it. Returns the same object. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Makes an independent, fully frozen copy. The original passed in is not changed. */
export function frozenCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}
