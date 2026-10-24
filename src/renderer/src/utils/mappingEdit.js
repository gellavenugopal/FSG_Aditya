// A single-row categorisation edit on the Mapped TB grid: the saved row is the
// row as it stands, with the edited fields laid over it. A field present in
// `updates` wins even when it is null — that is how changing Mapping 1 clears
// Mapping 2 / 3, the Level 4-7 values and the format row.
//
// This used `updates.x ?? rowData.x`, which reads an explicit null as "not
// given" and keeps the old value. Moving "Purchase Gst 5%" from the GST balance
// head to Purchases of Stock-in-Trade therefore saved it with Level 2 still
// "Short-term loans and advances" (hidden on the grid, because that is no
// option of the new Mapping 1), and the P&L note printed that Balance Sheet
// heading as one of its lines (Santosh Kumar Gupta, 13 Sep 2026).
const FIELDS = ['mapping1_resultant', 'mapping2_resultant', 'mapping3_resultant', 'level_format_id',
  'level4_value', 'level5_value', 'level6_value', 'level7_value']

export function mergeMappingEdit(rowData, updates) {
  const merged = {}
  for (const key of FIELDS) {
    merged[key] = Object.prototype.hasOwnProperty.call(updates || {}, key) ? updates[key] : (rowData?.[key] ?? null)
  }
  merged.override_note = rowData?.override_note || null
  return merged
}
