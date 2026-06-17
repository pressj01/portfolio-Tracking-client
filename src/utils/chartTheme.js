// Shared Plotly color theme so charts follow the light/dark app theme.
// The color source of truth is src/index.css. Plotly needs explicit layout
// values, so this helper reads the CSS variables and hands them to charts.
export function chartTheme(isDark) {
  const fallback = isDark
    ? {
        template: 'plotly_dark',
        paper: '#0e1117',
        plot: '#0e1117',
        surface: '#16213e',
        grid: '#1a2233',
        font: '#8899aa',
        title: '#e0e8f5',
        zeroline: '#556677',
      }
    : {
        template: 'plotly',
        paper: '#ffffff',
        plot: '#ffffff',
        surface: '#ffffff',
        grid: '#e2e6ee',
        font: '#5a6675',
        title: '#0f1726',
        zeroline: '#b8c2d0',
      }

  if (typeof window === 'undefined' || !window.getComputedStyle) return fallback

  const styles = window.getComputedStyle(document.documentElement)
  const read = (name, key) => styles.getPropertyValue(name).trim() || fallback[key]

  return {
    template: read('--chart-template', 'template'),
    paper: read('--chart-paper', 'paper'),
    plot: read('--chart-plot', 'plot'),
    surface: read('--chart-surface', 'surface'),
    grid: read('--chart-grid', 'grid'),
    font: read('--chart-font', 'font'),
    title: read('--chart-title', 'title'),
    zeroline: read('--chart-zeroline', 'zeroline'),
  }
}

const DARK_TEXT_COLORS = new Set([
  '#e0e8f5', '#e0e8f0', '#e0e0e0', '#d0dde8', '#c0cdd8',
  '#b8c7d9', '#b8c8e0', '#c7d4e8', '#cfd8e3', '#aaa', '#90caf9',
])
const DARK_GRID_COLORS = new Set([
  '#333', '#334', '#3a3a4e', '#3a3a5c', '#1a2a3e', '#2a3a4e',
  '#555', '#888', 'rgba(255,255,255,0.08)', 'rgba(255, 255, 255, 0.08)',
])
const DARK_SURFACE_COLORS = new Set([
  '#111124', '#0e1117', '#1a1f2e', '#1e1e2f', '#16213e',
  'rgba(255,255,255,0.03)', 'rgba(255, 255, 255, 0.03)',
])

function normalizeThemeColor(color, replacement, isDark, palette = DARK_TEXT_COLORS) {
  if (isDark || !color || typeof color !== 'string') return color
  return palette.has(color.trim().toLowerCase()) ? replacement : color
}

function themedAxis(axis, ct, isDark) {
  if (!axis || typeof axis !== 'object') return axis
  const axisTitle = axis.title && typeof axis.title === 'object'
    ? {
        ...axis.title,
        font: {
          ...(axis.title.font || {}),
          color: normalizeThemeColor(axis.title.font?.color, ct.font, isDark) || ct.font,
        },
      }
    : axis.title
  const tickfont = axis.tickfont && typeof axis.tickfont === 'object'
    ? { ...axis.tickfont, color: normalizeThemeColor(axis.tickfont.color, ct.font, isDark) || ct.font }
    : axis.tickfont
  const titlefont = axis.titlefont && typeof axis.titlefont === 'object'
    ? { ...axis.titlefont, color: normalizeThemeColor(axis.titlefont.color, ct.font, isDark) || ct.font }
    : axis.titlefont
  return {
    ...axis,
    title: axisTitle,
    color: normalizeThemeColor(axis.color, ct.font, isDark) || axis.color,
    gridcolor: normalizeThemeColor(axis.gridcolor, ct.grid, isDark, DARK_GRID_COLORS) || ct.grid,
    zerolinecolor: normalizeThemeColor(axis.zerolinecolor, ct.zeroline, isDark, DARK_GRID_COLORS) || ct.zeroline,
    tickfont,
    titlefont,
  }
}

export function themedPlotlyLayout(layout = {}, isDark, options = {}) {
  if (!layout || typeof layout !== 'object') layout = {}
  const ct = chartTheme(isDark)
  const paper = options.surface ? ct.surface : ct.paper
  const plot = options.surface ? ct.surface : ct.plot
  const titleFontColor = layout.title && typeof layout.title === 'object' && layout.title.font
    ? normalizeThemeColor(layout.title.font.color, ct.title, isDark)
    : null
  const title = typeof layout.title === 'string'
    ? { text: layout.title, font: { color: ct.title } }
    : layout.title
      ? { ...layout.title, font: { ...(layout.title.font || {}), color: titleFontColor || ct.title } }
      : layout.title

  const themed = {
    ...layout,
    template: ct.template,
    paper_bgcolor: layout.paper_bgcolor === 'transparent' ? 'transparent' : paper,
    plot_bgcolor: layout.plot_bgcolor === 'transparent' ? 'transparent' : plot,
    font: { ...(layout.font || {}), color: normalizeThemeColor(layout.font?.color, ct.font, isDark) || ct.font },
    title,
    xaxis: themedAxis(layout.xaxis, ct, isDark),
    xaxis2: themedAxis(layout.xaxis2, ct, isDark),
    yaxis: themedAxis(layout.yaxis, ct, isDark),
    yaxis2: themedAxis(layout.yaxis2, ct, isDark),
    yaxis3: themedAxis(layout.yaxis3, ct, isDark),
    legend: layout.legend
      ? { ...layout.legend, font: { ...(layout.legend.font || {}), color: normalizeThemeColor(layout.legend.font?.color, ct.font, isDark) || ct.font } }
      : layout.legend,
    hoverlabel: layout.hoverlabel
      ? {
          ...layout.hoverlabel,
          bgcolor: normalizeThemeColor(layout.hoverlabel.bgcolor, ct.surface, isDark, DARK_SURFACE_COLORS) || layout.hoverlabel.bgcolor,
          bordercolor: normalizeThemeColor(layout.hoverlabel.bordercolor, ct.grid, isDark, DARK_GRID_COLORS) || layout.hoverlabel.bordercolor,
          font: {
            ...(layout.hoverlabel.font || {}),
            color: normalizeThemeColor(layout.hoverlabel.font?.color, ct.title, isDark) || ct.title,
          },
        }
      : layout.hoverlabel,
  }
  Object.keys(themed).forEach(key => {
    if (themed[key] === undefined) delete themed[key]
  })
  return themed
}
