type ClassValue = string | number | false | null | undefined;

/** Tiny classnames helper (no runtime dependency). */
export function clsx(...values: ClassValue[]): string {
  return values.filter((v) => typeof v === 'string' && v.length > 0 || typeof v === 'number').join(' ');
}
