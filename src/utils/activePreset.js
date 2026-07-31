/**
 * Which scanner preset, if any, the current filter state still matches.
 *
 * A preset is a bag of ~20 filter fields merged into the live filter state, so
 * "active" means every field that preset sets still holds its preset value.
 * Editing any one of them afterwards clears the highlight rather than claiming
 * a preset that is no longer what the scan will run.
 *
 * Numbers are compared after coercion because a filter value can come back
 * from localStorage or a number input as a string.
 */
export function findActivePreset(presets, filters) {
  if (!presets || !filters) return null
  return Object.keys(presets).find(key => {
    const presetFilters = presets[key]?.filters
    if (!presetFilters) return false
    return Object.entries(presetFilters).every(([field, value]) => (
      typeof value === 'number'
        ? Number(filters[field]) === value
        : filters[field] === value
    ))
  }) || null
}
