// Browser-side actions behind the comparer charts' Options and Download menus:
// file downloads, Excel (written by the backend), Google Sheets hand-off,
// printing, PNG export and full screen. Shared by Compare ETFs, Compare Stocks
// and the Stock and ETF Analysis Returns tab.

import { API_BASE } from '../config'
import { tableToDelimited } from './chartMetrics'

// On/off chart preferences (date picker, scale side, full width) shared by the
// three comparer screens. Storage can be unavailable; the default then holds.
export function readStoredFlag(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : raw === '1'
  } catch {
    return fallback
  }
}

export function storeFlag(key, value) {
  try { localStorage.setItem(key, value ? '1' : '0') } catch { /* preference only */ }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadTableCsv(table, stem) {
  // The byte-order mark makes Excel open the file as UTF-8.
  const blob = new Blob(['﻿', tableToDelimited(table, ',')], { type: 'text/csv;charset=utf-8;' })
  const filename = `${stem}.csv`
  downloadBlob(blob, filename)
  return filename
}

export async function downloadTableExcel(table, { stem, sheet }) {
  const response = await fetch(`${API_BASE}/api/export/chart-xlsx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: stem, sheet, columns: table.columns, rows: table.rows }),
  })
  if (!response.ok) {
    let message = `Excel export failed (${response.status})`
    try { message = (await response.json())?.error || message } catch { /* not JSON */ }
    throw new Error(message)
  }
  const filename = `${stem}.xlsx`
  downloadBlob(await response.blob(), filename)
  return filename
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older Electron builds and unfocused windows refuse the async API.
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let copied = false
    try { copied = document.execCommand('copy') } catch { copied = false }
    area.remove()
    return copied
  }
}

// Google Sheets has no import URL a desktop app can post to without signing the
// user in to Google, so hand the data over the clipboard: copy it as
// tab-separated rows (which Sheets splits into cells on paste) and open a new
// blank sheet in the user's browser, where they are already signed in.
export async function sendTableToGoogleSheets(table) {
  const copied = await writeClipboard(tableToDelimited(table, '\t'))
  window.open('https://sheets.new', '_blank', 'noopener')
  return copied
}

function graphSize(graphDiv) {
  const width = Math.max(600, Math.round(graphDiv?.clientWidth || 0) || 1200)
  const height = Math.max(360, Math.round(graphDiv?.clientHeight || 0) || 560)
  return { width, height }
}

export async function downloadChartImage(graphDiv, stem) {
  const Plotly = window.Plotly
  if (!Plotly || !graphDiv) throw new Error('The chart is not ready yet.')
  const { width, height } = graphSize(graphDiv)
  await Plotly.downloadImage(graphDiv, { format: 'png', filename: stem, width, height, scale: 2 })
  return `${stem}.png`
}

const PRINT_INK = '#111827'
const PRINT_GRID = '#e5e7eb'

function printAxis(axis) {
  if (!axis || typeof axis !== 'object') return axis
  const title = typeof axis.title === 'string' ? { text: axis.title } : axis.title
  return {
    ...axis,
    color: PRINT_INK,
    gridcolor: PRINT_GRID,
    zerolinecolor: '#9ca3af',
    linecolor: '#9ca3af',
    tickfont: { ...(axis.tickfont || {}), color: PRINT_INK },
    title: title ? { ...title, font: { ...(title.font || {}), color: PRINT_INK } } : title,
    // The range slider is an on-screen control; paper only needs the chart.
    rangeslider: axis.rangeslider ? { ...axis.rangeslider, visible: false } : axis.rangeslider,
  }
}

// A dark chart printed as-is spends a page of toner on its background, so the
// printout re-renders the same figure on white with dark text.
function printLayout(layout = {}) {
  const title = typeof layout.title === 'string' ? { text: layout.title } : layout.title
  const out = {
    ...layout,
    template: undefined,
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    font: { ...(layout.font || {}), color: PRINT_INK },
    title: title ? { ...title, font: { ...(title.font || {}), color: PRINT_INK } } : title,
    legend: layout.legend ? { ...layout.legend, font: { ...(layout.legend.font || {}), color: PRINT_INK } } : layout.legend,
  }
  Object.keys(layout).forEach(key => {
    if (/^[xy]axis\d*$/.test(key)) out[key] = printAxis(layout[key])
  })
  return out
}

export async function printChart(graphDiv, heading = '') {
  const Plotly = window.Plotly
  if (!Plotly || !graphDiv?.data) throw new Error('The chart is not ready yet.')
  const width = 1500
  const height = 820
  const url = await Plotly.toImage(
    { data: graphDiv.data, layout: { ...printLayout(graphDiv.layout), width, height } },
    { format: 'png', width, height, scale: 2 },
  )
  document.querySelectorAll('.chart-print-sheet').forEach(node => node.remove())
  const sheet = document.createElement('div')
  sheet.className = 'chart-print-sheet'
  if (heading) {
    const title = document.createElement('h2')
    title.textContent = heading
    sheet.appendChild(title)
  }
  const image = document.createElement('img')
  image.src = url
  image.alt = heading || 'Chart'
  sheet.appendChild(image)
  const stamp = document.createElement('p')
  stamp.textContent = `Printed ${new Date().toLocaleString()}`
  sheet.appendChild(stamp)
  document.body.appendChild(sheet)
  try { await image.decode() } catch { /* print anyway */ }

  const cleanup = () => {
    document.body.classList.remove('chart-printing')
    sheet.remove()
    window.removeEventListener('afterprint', cleanup)
  }
  document.body.classList.add('chart-printing')
  window.addEventListener('afterprint', cleanup)
  window.print()
  // Some print dialogs return before printing and fire afterprint late (or
  // never); the sheet is invisible on screen, so a late cleanup is harmless.
  window.setTimeout(cleanup, 120000)
}

export function isElementFullscreen(element) {
  return Boolean(element && document.fullscreenElement === element)
}

export async function toggleElementFullscreen(element) {
  if (!element) return
  if (document.fullscreenElement) {
    await document.exitFullscreen()
    return
  }
  await element.requestFullscreen()
}
