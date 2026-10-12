import Plot from 'react-plotly.js'
import { useTheme } from '../context/ThemeContext'
import { themedPlotlyLayout } from '../utils/chartTheme'
import { convertPlotlyCurrency } from '../utils/money'
import { useCurrency } from '../context/CurrencyContext'
import { keepUnifiedHoverRanked, stopRankingUnifiedHover } from '../utils/rankedUnifiedHover'

// rankUnifiedHover: list the series in an 'x unified' hover box from the
// highest value at the hovered date to the lowest, instead of in trace order.
export default function ThemedPlot({
  data,
  layout,
  themeSurface = false,
  rankUnifiedHover = false,
  onInitialized,
  onUpdate,
  onPurge,
  ...props
}) {
  const { isDark } = useTheme()
  useCurrency()
  const converted = convertPlotlyCurrency(data, layout)
  const ranked = (attach, forward) => (rankUnifiedHover
    ? (figure, graphDiv) => {
        attach(graphDiv)
        forward?.(figure, graphDiv)
      }
    : forward)
  return (
    <Plot
      {...props}
      onInitialized={ranked(keepUnifiedHoverRanked, onInitialized)}
      onUpdate={ranked(keepUnifiedHoverRanked, onUpdate)}
      onPurge={ranked(stopRankingUnifiedHover, onPurge)}
      data={converted.data}
      layout={themedPlotlyLayout(converted.layout, isDark, { surface: themeSurface })}
    />
  )
}

