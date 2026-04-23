const DEFAULT_PRIORITY = 10_000;
const HIDDEN_VISIBILITIES = new Set(["hide", "hidden"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Parse the live payload returned by `GET /backend-api/codex/models`. Shape is
// `{ models: [{ slug, supported_in_api, visibility, priority, display_name,
// description, ... }, ...] }`. Filters are deliberately minimal so future
// Codex model additions surface automatically without a code change:
//
// - drop entries missing a `slug`
// - drop entries with `supported_in_api === false`
// - drop entries whose `visibility` equals `"hide"` or `"hidden"` (case-
//   insensitive)
//
// Output is sorted by `(priority, slug)` ascending to match the Codex client
// reference ordering, and shaped as `{ id, description }` so the settings UI
// can consume the live catalog with the same reducer as the static fallback.
export function parseCodexModelsResponse(payload) {
  const entries = Array.isArray(payload?.models) ? payload.models : [];
  const result = [];

  for (const entry of entries) {
    if (!isObject(entry)) {
      continue;
    }

    const slug = normalizeText(entry.slug);

    if (!slug) {
      continue;
    }

    if (entry.supported_in_api === false) {
      continue;
    }

    const visibility = normalizeText(entry.visibility).toLowerCase();

    if (HIDDEN_VISIBILITIES.has(visibility)) {
      continue;
    }

    const priority = Number.isFinite(entry.priority) ? Number(entry.priority) : DEFAULT_PRIORITY;
    const description = normalizeText(entry.description) || normalizeText(entry.display_name);

    result.push({
      description,
      id: slug,
      priority
    });
  }

  result.sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return left.id.localeCompare(right.id);
  });

  return result.map(({ description, id }) => ({ description, id }));
}
