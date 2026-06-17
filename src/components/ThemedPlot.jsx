import Plot from 'react-plotly.js'
import { useTheme } from '../context/ThemeContext'
import { themedPlotlyLayout } from '../utils/chartTheme'

export default function ThemedPlot({ layout, themeSurface = false, ...props }) {
  const { isDark } = useTheme()
  return (
    <Plot
      {...props}
      layout={themedPlotlyLayout(layout, isDark, { surface: themeSurface })}
    />
  )
}

