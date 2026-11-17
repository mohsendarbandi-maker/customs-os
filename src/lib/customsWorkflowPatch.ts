type JsonObject = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const equalJson = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((value, index) => equalJson(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && equalJson(left[key], right[key]));
};

/** Apply a nested JSONB patch locally without replacing untouched leaves. */
export function mergeCustomsWorkflowJsonbPatch(
  baseline: JsonObject,
  patch: JsonObject,
): JsonObject {
  const merged: JsonObject = { ...baseline };
  for (const [key, nextValue] of Object.entries(patch)) {
    const previousValue = merged[key];
    if (isRecord(previousValue) && isRecord(nextValue)) {
      merged[key] = mergeCustomsWorkflowJsonbPatch(previousValue, nextValue);
    } else {
      merged[key] = nextValue;
    }
  }
  return merged;
}

/**
 * Build a minimal nested patch between the last value shown to this operator
 * and the value currently in the editor. The server merges this patch into the
 * latest row while checking that none of the touched leaves changed meanwhile.
 */
export function buildCustomsWorkflowJsonbPatch(
  baseline: JsonObject,
  current: JsonObject,
): JsonObject {
  const patch: JsonObject = {};
  for (const [key, nextValue] of Object.entries(current)) {
    const previousValue = baseline[key];
    if (isRecord(previousValue) && isRecord(nextValue)) {
      const nested = buildCustomsWorkflowJsonbPatch(previousValue, nextValue);
      if (Object.keys(nested).length > 0) patch[key] = nested;
    } else if (!equalJson(previousValue, nextValue)) {
      patch[key] = nextValue;
    }
  }
  return patch;
}
