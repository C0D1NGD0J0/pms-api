const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]';

// Key paths (never values) present in the raw input but dropped by Zod's parse; array indices collapse to "[]"
export const collectStrippedPaths = (
  raw: unknown,
  parsed: unknown,
  prefix: string,
  found: Set<string> = new Set()
): Set<string> => {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    raw.forEach((item, index) => collectStrippedPaths(item, parsed[index], `${prefix}[]`, found));
  } else if (isPlainObject(raw) && isPlainObject(parsed)) {
    for (const [key, value] of Object.entries(raw)) {
      if (value === undefined) continue;
      const path = `${prefix}.${key}`;
      if (Object.prototype.hasOwnProperty.call(parsed, key)) {
        collectStrippedPaths(value, parsed[key], path, found);
      } else {
        found.add(path);
      }
    }
  }
  return found;
};
