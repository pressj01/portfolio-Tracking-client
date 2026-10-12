// Plotly's 'x unified' hover box lists series in trace order — the order the
// tickers were added — so once the lines have crossed, the values in the box
// run in no particular order. Plotly has no option to sort the box by value
// (`legendrank` is fixed per trace, not per hovered date), so the rows are
// re-stacked after Plotly draws them: highest value on top, lowest at the
// bottom.
//
// The re-stack has to follow the *drawing*, not the `plotly_hover` event.
// Plotly repaints the box, back in trace order, on every mouse move, but only
// emits `plotly_hover` when the hovered point changes. Ranking inside that
// event therefore lasts until the mouse moves one more pixel over the same
// date, and then the order snaps back. Watching the hover layer catches every
// repaint, including the ones that fire no event (`Plotly.Fx.hover`, the
// re-hover after a zoom).

// The box is drawn as a temporary SVG legend: one `g.traces` per series, each
// translated to the vertical centre of its slot.
const ROW_GROUPS = 'g.legend g.groups'
const TRANSLATE = /translate\(\s*(-?[\d.]+(?:e[-+]?\d+)?)[\s,]+(-?[\d.]+(?:e[-+]?\d+)?)\s*\)/i

function numeric(value) {
  if (value == null || value === '') return Number.NaN
  const number = Number(value)
  return Number.isFinite(number) ? number : Number.NaN
}

// rows: [{ center, height, value }] in the order Plotly drew them. Returns the
// new centre for each row (same indexes), or null when the box cannot be
// ranked safely — in which case it is left exactly as Plotly drew it.
//
// Slots are rebuilt from each row's own height rather than by swapping
// positions, so rows of different heights never overlap. The top of the first
// slot is the same before and after, which makes this idempotent: ranking an
// already-ranked box moves nothing.
export function rankHoverRows(rows = []) {
  if (rows.length < 2) return null
  const usable = rows.every(row => (
    Number.isFinite(row.center) && Number.isFinite(row.value) && row.height > 0
  ))
  if (!usable) return null

  const top = Math.min(...rows.map(row => row.center - row.height / 2))
  // Array.prototype.sort is stable, so equal values keep Plotly's order.
  const order = rows.map((_, index) => index).sort((a, b) => rows[b].value - rows[a].value)
  const centers = new Array(rows.length)
  let cursor = top
  order.forEach((index) => {
    centers[index] = cursor + rows[index].height / 2
    cursor += rows[index].height
  })
  return centers
}

// Re-stack the rows of the unified hover box inside `hoverLayer`, best first.
// Every guard leaves Plotly's own layout untouched, so a future change to its
// internal markup degrades to the old unranked box instead of a broken one.
export function rankUnifiedHoverBox(hoverLayer) {
  if (!hoverLayer?.querySelectorAll) return
  // Legend groups carry their own offsets; only a single flat list is ranked.
  const groups = hoverLayer.querySelectorAll(ROW_GROUPS)
  if (groups.length !== 1) return

  const elements = Array.from(groups[0].children || []).filter(el => el.classList?.contains('traces'))
  const rows = elements.map((el) => {
    const match = TRANSLATE.exec(el.getAttribute('transform') || '')
    // d3 keeps each row's hover point on the element: its drawn height and the
    // same event data `plotly_hover` reports.
    const point = el.__data__?.[0]
    return {
      x: match ? match[1] : null,
      center: match ? Number(match[2]) : Number.NaN,
      height: numeric(point?.height),
      value: numeric(point?.eventData?.[0]?.y),
    }
  })

  const centers = rankHoverRows(rows)
  if (!centers) return
  elements.forEach((el, index) => {
    // Skipping rows already in place keeps a repeat pass free of DOM writes.
    if (Math.abs(centers[index] - rows[index].center) < 0.01) return
    el.setAttribute('transform', `translate(${rows[index].x},${centers[index]})`)
  })
}

const watchers = new WeakMap()

// Keep `graphDiv`'s unified hover box ranked for as long as the plot lives.
// Safe to call after every plot update: it re-attaches only when Plotly has
// rebuilt its hover layer.
export function keepUnifiedHoverRanked(graphDiv) {
  if (!graphDiv?.querySelector || typeof MutationObserver === 'undefined') return
  const layer = graphDiv.querySelector('g.hoverlayer')
  const current = watchers.get(graphDiv)
  if (current && current.layer === layer) return
  stopRankingUnifiedHover(graphDiv)
  if (!layer) return

  const observer = new MutationObserver(() => {
    try {
      rankUnifiedHoverBox(layer)
    } catch {
      /* hover is cosmetic — never let it break the chart */
    }
    // Drop the records our own moves just queued.
    observer.takeRecords()
  })
  observer.observe(layer, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['transform'],
  })
  watchers.set(graphDiv, { layer, observer })
}

export function stopRankingUnifiedHover(graphDiv) {
  const current = graphDiv ? watchers.get(graphDiv) : null
  if (!current) return
  current.observer.disconnect()
  watchers.delete(graphDiv)
}
