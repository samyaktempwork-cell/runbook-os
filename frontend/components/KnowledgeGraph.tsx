'use client'

import dynamic from 'next/dynamic'
import { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import type { GraphSocketState } from '@/hooks/useGraphSocket'
import type { GraphNode, GraphEdge, NodeType } from '@/lib/types'

// Must be dynamically imported — react-force-graph uses canvas APIs (browser only)
const ForceGraph2D = dynamic(
  () => import('react-force-graph-2d'),
  { ssr: false, loading: () => <GraphPlaceholder /> }
)

// ---------------------------------------------------------------------------
// Color maps
// ---------------------------------------------------------------------------

const NODE_COLORS: Record<NodeType, string> = {
  service: '#6366f1',   // indigo
  error:   '#f43f5e',   // rose
  step:    '#f59e0b',   // amber
  outcome: '#10b981',   // emerald
  pattern: '#8b5cf6',   // violet
}

const NODE_COLORS_DIM: Record<NodeType, string> = {
  service: '#c7d2fe',
  error:   '#fecdd3',
  step:    '#fde68a',
  outcome: '#a7f3d0',
  pattern: '#ddd6fe',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props extends GraphSocketState {
  onNodeClick?: (node: GraphNode) => void
  patternHighlight?: Set<string>   // node IDs to glow violet on pattern click
}

export default function KnowledgeGraph({
  graphData,
  animationMode,
  traversedNodes,
  highlightedPath,
  dimNonPath,
  pulsingNodes,
  onNodeClick,
  patternHighlight,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [pinnedNodes, setPinnedNodes] = useState<Set<string>>(new Set())

  // Resize observer — graph fills its container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setDimensions({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // D3 force tuning — applied after ForceGraph2D mounts (fgRef populated)
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    // Strong repulsion prevents node pile-up at any scale
    fg.d3Force('charge')?.strength(-400)
    fg.d3Force('link')?.distance(90)
    // Collide force added via dynamic require — d3-force-3d is a transitive dep of react-force-graph
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { forceCollide } = require('d3-force-3d') as { forceCollide: (r: number) => any }
      if (!fgRef.current) return
      fgRef.current.d3Force('collide', forceCollide(22).strength(0.9))
      fgRef.current.d3ReheatSimulation()
    })()
  }, [dimensions])

  // 2-hop filter — when traversal is active, show only traversed nodes + direct neighbours
  const displayGraphData = useMemo(() => {
    if (traversedNodes.size === 0) return graphData

    const neighbourIds = new Set<string>(traversedNodes)
    for (const link of graphData.links) {
      const src = typeof link.source === 'object' ? (link.source as GraphNode).id : link.source
      const tgt = typeof link.target === 'object' ? (link.target as GraphNode).id : link.target
      if (traversedNodes.has(src)) neighbourIds.add(tgt)
      if (traversedNodes.has(tgt)) neighbourIds.add(src)
    }

    return {
      nodes: graphData.nodes.filter((n) => neighbourIds.has(n.id)),
      links: graphData.links.filter((l) => {
        const src = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source
        const tgt = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target
        return neighbourIds.has(src) && neighbourIds.has(tgt)
      }),
    }
  }, [graphData, traversedNodes])

  // ---------------------------------------------------------------------------
  // Custom node rendering — canvas-based for glow effects
  // ---------------------------------------------------------------------------

  const nodeCanvasObject = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as GraphNode & { x: number; y: number }
      const isTraversed = traversedNodes.has(n.id)
      const isOnPath = highlightedPath.includes(n.id)
      const pulseColor = pulsingNodes.get(n.id)
      const isPatternMatch = patternHighlight ? patternHighlight.has(n.id) : false
      const isDimmed = (dimNonPath && !isTraversed && !isOnPath) ||
                       (patternHighlight && patternHighlight.size > 0 && !isPatternMatch)

      // Node radius — scales with incident_count
      const radius = Math.max(4, Math.min(12, 4 + (n.incident_count - 1) * 1.5))

      // Resolve fill color
      let fillColor: string
      let glowColor: string | null = null
      let glowBlur = 0

      if (isPatternMatch) {
        fillColor = '#8b5cf6'   // violet — pattern match
        glowColor = '#8b5cf6'
        glowBlur = 16
      } else if (pulseColor) {
        fillColor = pulseColor === 'green' ? '#22c55e' : '#ef4444'
        glowColor = fillColor
        glowBlur = 20
      } else if (isTraversed && animationMode === 'recall') {
        fillColor = '#f97316'  // orange — traversal
        glowColor = '#f97316'
        glowBlur = 18
      } else if (isOnPath && animationMode === 'recall') {
        fillColor = '#f97316'
        glowColor = '#f97316'
        glowBlur = 10
      } else if (animationMode === 'learn' && !isDimmed) {
        fillColor = NODE_COLORS[n.type]
        glowColor = NODE_COLORS[n.type]
        glowBlur = 12
      } else if (isDimmed) {
        fillColor = NODE_COLORS_DIM[n.type]
      } else {
        fillColor = NODE_COLORS[n.type]
      }

      // Apply opacity for dimmed nodes
      ctx.globalAlpha = isDimmed ? 0.25 : n.confidence

      // Glow effect
      if (glowColor && glowBlur) {
        ctx.shadowColor = glowColor
        ctx.shadowBlur = glowBlur
      }

      // Draw node circle
      ctx.beginPath()
      ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI)
      ctx.fillStyle = fillColor
      ctx.fill()

      // Reset shadow before border (avoid glow on border)
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0

      // Border — slightly lighter than fill
      ctx.beginPath()
      ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI)
      ctx.strokeStyle = isDimmed ? '#cbd5e1' : `${fillColor}cc`
      ctx.lineWidth = 1.5 / globalScale
      ctx.stroke()

      // Node label — always visible, size scales with zoom so it's readable at any level
      if (!isDimmed) {
        const fontSize = Math.min(13, Math.max(9, 11 / globalScale))
        ctx.font = `${fontSize}px monospace`
        ctx.fillStyle = isTraversed || isOnPath ? '#7c3aed' : '#334155'
        ctx.globalAlpha = Math.min(1, 0.5 + globalScale * 0.5)
        ctx.textAlign = 'center'
        ctx.shadowColor = 'rgba(255,255,255,0.9)'
        ctx.shadowBlur = 3
        ctx.fillText(n.label.length > 18 ? n.label.slice(0, 16) + '…' : n.label, n.x, n.y + radius + fontSize * 0.9)
        ctx.shadowBlur = 0
        ctx.globalAlpha = 1
      }

      ctx.globalAlpha = 1
    },
    [animationMode, traversedNodes, highlightedPath, dimNonPath, pulsingNodes]
  )

  // ---------------------------------------------------------------------------
  // Custom link rendering
  // ---------------------------------------------------------------------------

  const linkCanvasObject = useCallback(
    (link: object, ctx: CanvasRenderingContext2D) => {
      const l = link as GraphEdge & { source: { x: number; y: number; id: string }; target: { x: number; y: number; id: string } }
      if (!l.source?.x || !l.target?.x) return

      const srcId = l.source.id
      const tgtId = l.target.id
      const isOnPath = highlightedPath.includes(srcId) && highlightedPath.includes(tgtId)
      const isTraversedEdge = animationMode === 'recall' &&
        (traversedNodes.has(srcId) || traversedNodes.has(tgtId))
      const isDimmed = dimNonPath && !isOnPath && !isTraversedEdge

      ctx.globalAlpha = isDimmed ? 0.08 : isTraversedEdge ? 0.9 : 0.65

      // Edge thickness from weight
      const width = Math.max(0.5, (l.weight || 0.5) * 3)
      ctx.lineWidth = width

      ctx.beginPath()
      ctx.moveTo(l.source.x, l.source.y)
      ctx.lineTo(l.target.x, l.target.y)

      if (isOnPath && animationMode === 'recall') {
        ctx.strokeStyle = '#f97316'
        ctx.shadowColor = '#f97316'
        ctx.shadowBlur = 8
      } else if (isTraversedEdge) {
        ctx.strokeStyle = '#fb923c'   // lighter orange for traversal edges
        ctx.shadowColor = '#fb923c'
        ctx.shadowBlur = 4
      } else {
        ctx.strokeStyle = '#cbd5e1'
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
      }

      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.globalAlpha = 1
    },
    [animationMode, highlightedPath, dimNonPath, traversedNodes]
  )

  // ---------------------------------------------------------------------------
  // Interaction handlers
  // ---------------------------------------------------------------------------

  const handleNodeClick = useCallback(
    (node: object) => {
      const n = node as GraphNode & { fx?: number; fy?: number; x: number; y: number }
      // Pin / unpin node
      if (pinnedNodes.has(n.id)) {
        n.fx = undefined
        n.fy = undefined
        setPinnedNodes((prev) => { const s = new Set(prev); s.delete(n.id); return s })
      } else {
        n.fx = n.x
        n.fy = n.y
        setPinnedNodes((prev) => new Set([...prev, n.id]))
      }
      onNodeClick?.(n as GraphNode)
    },
    [pinnedNodes, onNodeClick]
  )

  const handleNodeHover = useCallback((node: object | null) => {
    setHoveredNode(node ? (node as GraphNode) : null)
    document.body.style.cursor = node ? 'pointer' : 'default'
  }, [])

  return (
    <div ref={containerRef} className="graph-container relative w-full h-full">
      <ForceGraph2D
        ref={fgRef}
        graphData={displayGraphData as { nodes: object[]; links: object[] }}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="#f8fafc"
        nodeId="id"
        nodeLabel=""             // we draw labels in nodeCanvasObject
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => 'replace'}
        linkCanvasObject={linkCanvasObject}
        linkCanvasObjectMode={() => 'replace'}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={() => '#cbd5e1'}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        cooldownTicks={150}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        enableNodeDrag
        enableZoomInteraction
        minZoom={0.3}
        maxZoom={8}
      />

      {/* Hover tooltip */}
      {hoveredNode && (
        <div className="absolute top-4 right-4 bg-white border border-slate-200 rounded-lg p-3 font-mono text-xs pointer-events-none shadow-md">
          <div className="text-slate-900 font-semibold mb-1">{hoveredNode.label}</div>
          <div className="text-slate-500 space-y-0.5">
            <div>type: <span className="text-indigo-600">{hoveredNode.type}</span></div>
            <div>incidents: <span className="text-amber-600">{hoveredNode.incident_count}</span></div>
            <div>confidence: <span className="text-emerald-600">{(hoveredNode.confidence * 100).toFixed(0)}%</span></div>
          </div>
          {pinnedNodes.has(hoveredNode.id) && (
            <div className="mt-1 text-orange-500 text-[10px]">PINNED — click to release</div>
          )}
        </div>
      )}

      {/* Empty state */}
      {graphData.nodes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-slate-400 font-mono text-sm text-center">
            <div className="text-2xl mb-3 opacity-30">◎</div>
            <div>No incidents in memory yet.</div>
            <div className="text-[10px] mt-1">Use FEED mode to add the first incident.</div>
          </div>
        </div>
      )}
    </div>
  )
}

function GraphPlaceholder() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="font-mono text-slate-400 text-sm animate-pulse">Loading graph engine…</div>
    </div>
  )
}
