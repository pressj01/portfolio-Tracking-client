// Signed percentage text for Plotly hover boxes: "+12.34%", "-3.10%".
//
// A hovertemplate cannot ask for the "+" itself. Plotly 3 prepends "~" to any
// number format that does not start with one of "~ , . 0 $", so "%{y:+.2f}"
// becomes "~+.2f", d3 rejects it, and Plotly falls back to printing the raw
// float ("27.96650000000001%") with no console error. Format the text here,
// pass it through `customdata` or `text`, and reference it with no format
// ("%{customdata}").
export function signedPercent(value, digits = 2) {
  const number = Number(value)
  if (value == null || value === '' || !Number.isFinite(number)) return '-'
  const magnitude = Math.abs(number).toFixed(digits)
  // A small loss that rounds away reads "+0.00%", not "-0.00%".
  const sign = number < 0 && Number(magnitude) !== 0 ? '-' : '+'
  return `${sign}${magnitude}%`
}
