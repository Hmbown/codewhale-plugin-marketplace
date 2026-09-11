// Missing observations are unknown, including for negative expectations.
export function observation(state, dotted) {
  for (const key of dotted.split(".")) {
    if (state === null || typeof state !== "object" || !Object.hasOwn(state, key)) return { present: false };
    state = state[key];
  }
  return { present: true, value: state };
}

export function checkExpect(exp, state) {
  const { present, value } = observation(state, exp.path);
  if (!present) return false;
  if ("equals" in exp) return JSON.stringify(value) === JSON.stringify(exp.equals);
  if ("not_equals" in exp) return JSON.stringify(value) !== JSON.stringify(exp.not_equals);
  if ("gte" in exp) return typeof value === "number" && value >= exp.gte;
  if ("contains" in exp) return Array.isArray(value) ? value.includes(exp.contains) : typeof value === "string" && value.includes(exp.contains);
  return false;
}
