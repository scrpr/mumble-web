'use client'

import { useMemo } from 'react'
import { cn } from '../../src/ui/cn'

type LineChartProps = {
  data: number[]
  maxPoints?: number
  height?: number
  color?: string
  fillColor?: string
  label?: string
  unit?: string
  showGrid?: boolean
  minY?: number
  maxY?: number
  className?: string
}

export function LineChart({
  data,
  maxPoints = 60,
  height = 60,
  color = 'hsl(var(--primary))',
  fillColor,
  label,
  unit = '',
  showGrid = true,
  minY,
  maxY,
  className
}: LineChartProps) {
  const width = 200

  const { path, fillPath, computedMin, computedMax, currentValue } = useMemo(() => {
    if (data.length === 0) {
      return { path: '', fillPath: '', computedMin: 0, computedMax: 100, currentValue: null }
    }

    const points = data.slice(-maxPoints)
    const min = minY ?? Math.min(...points, 0)
    const max = maxY ?? Math.max(...points, 1)
    const range = max - min || 1

    const xStep = width / Math.max(maxPoints - 1, 1)
    const padding = 2

    const coords = points.map((val, i) => {
      const x = i * xStep
      const y = padding + (height - padding * 2) * (1 - (val - min) / range)
      return { x, y }
    })

    const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ')

    const lastCoord = coords[coords.length - 1]
    const firstCoord = coords[0]
    const fillPathD = lastCoord && firstCoord
      ? `${pathD} L ${lastCoord.x.toFixed(1)} ${height} L ${firstCoord.x.toFixed(1)} ${height} Z`
      : ''

    return {
      path: pathD,
      fillPath: fillPathD,
      computedMin: min,
      computedMax: max,
      currentValue: points[points.length - 1] ?? null
    }
  }, [data, maxPoints, height, minY, maxY])

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {(label || currentValue !== null) && (
        <div className="flex items-baseline justify-between text-[10px]">
          {label && <span className="text-muted-foreground font-medium uppercase">{label}</span>}
          {currentValue !== null && (
            <span className="font-mono text-foreground">
              {currentValue.toFixed(1)}{unit}
            </span>
          )}
        </div>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height }}
        preserveAspectRatio="none"
      >
        {showGrid && (
          <g className="text-border">
            <line x1="0" y1={height * 0.25} x2={width} y2={height * 0.25} stroke="currentColor" strokeOpacity="0.3" strokeDasharray="2,2" />
            <line x1="0" y1={height * 0.5} x2={width} y2={height * 0.5} stroke="currentColor" strokeOpacity="0.3" strokeDasharray="2,2" />
            <line x1="0" y1={height * 0.75} x2={width} y2={height * 0.75} stroke="currentColor" strokeOpacity="0.3" strokeDasharray="2,2" />
          </g>
        )}
        {fillPath && fillColor && (
          <path d={fillPath} fill={fillColor} fillOpacity="0.2" />
        )}
        {path && (
          <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
      {(computedMin !== undefined || computedMax !== undefined) && (
        <div className="flex justify-between text-[9px] text-muted-foreground/50">
          <span>{computedMin.toFixed(0)}{unit}</span>
          <span>{computedMax.toFixed(0)}{unit}</span>
        </div>
      )}
    </div>
  )
}
