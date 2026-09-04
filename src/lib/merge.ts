// Deep merge: `base` receives every plain-object key of `patch`; arrays and
// primitives in `patch` replace base values entirely. Used for data migration
// and backup import so missing keys never crash older/newer documents.

type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function mergeDeep(base: unknown, patch: unknown): unknown {
  if (isPlainObject(base) && isPlainObject(patch)) {
    const out: Plain = { ...base };
    for (const key of Object.keys(patch)) {
      if (patch[key] === undefined) continue;
      out[key] = isPlainObject(out[key]) ? mergeDeep(out[key], patch[key]) : patch[key];
    }
    return out;
  }
  return patch === undefined ? base : patch;
}
