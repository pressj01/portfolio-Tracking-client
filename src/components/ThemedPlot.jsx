import Plot from 'react-plotly.js'
import { useTheme } from '../context/ThemeContext'
import { themedPlotlyLayout } from '../utils/chartTheme'
import { convertPlotlyCurrency } from '../utils/money'
import { useCurrency } from '../context/CurrencyContext'

export default function ThemedPlot({ data, layout, themeSurface = false, ...props }) {
  const { isDark } = useTheme()
  useCurrency()
  const converted = convertPlotlyCurrency(data, layout)
  return (
    <Plot
      {...props}
      data={converted.data}
      layout={themedPlotlyLayout(converted.layout, isDark, { surface: themeSurface })}
    />
  )
}

