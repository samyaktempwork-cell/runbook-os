'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { GraphNode, GraphEdge, GraphEvent, RunbookStep, AnimationMode } from '@/lib/types'
import { api } from '@/lib/api'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws/events'
const RECONNECT_DELAY_MS = 3000
const RECALL_CLEAR_DELAY_MS = 5000   // clear traversal highlights 5s after recall_complete

export interface GraphState {
  nodes: GraphNode[]
  links: GraphEdge[]
}

export type LifecycleStage = 'remember' | 'recall' | 'improve' | 'forget' | null

export interface IncidentToast {
  kind: 'added' | 'removed'
  message: string
}

export interface GraphSocketState {
  graphData: GraphState
  animationMode: AnimationMode
  traversedNodes: Set<string>    // nodes lit orange during RECALL
  highlightedPath: string[]      // final winning path
  dimNonPath: boolean            // true during/after path_found until clear
  pulsingNodes: Map<string, 'green' | 'red'>  // nodes pulsing during IMPROVE
  runbookSteps: RunbookStep[]    // streamed steps from runbook_step events
  recallComplete: boolean
  isConnected: boolean
  lastEvent: string | null
  activeLifecycle: LifecycleStage  // which Cognee API just fired (auto-clears after 2s)
  graphPathReady: boolean     // true after path_found — safe to open RunbookViewer
  traversedCount: number      // live count of nodes scanned (for status strip)
  incidentToast: IncidentToast | null  // brief popup on incident added/removed
  clearRunbook: () => void
  resetGraph: () => void      // clears all traversal highlights (user-triggered)
}

export function useGraphSocket(): GraphSocketState {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recallClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [isConnected, setIsConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<string | null>(null)
  const [activeLifecycle, setActiveLifecycle] = useState<LifecycleStage>(null)
  const lifecycleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [animationMode, setAnimationMode] = useState<AnimationMode>('idle')
  const [traversedNodes, setTraversedNodes] = useState<Set<string>>(new Set())
  const [highlightedPath, setHighlightedPath] = useState<string[]>([])
  const [dimNonPath, setDimNonPath] = useState(false)
  const [pulsingNodes, setPulsingNodes] = useState<Map<string, 'green' | 'red'>>(new Map())
  const [runbookSteps, setRunbookSteps] = useState<RunbookStep[]>([])
  const [recallComplete, setRecallComplete] = useState(false)
  const [graphData, setGraphData] = useState<GraphState>({ nodes: [], links: [] })
  const [graphPathReady, setGraphPathReady] = useState(false)  // true after path_found fires
  const [traversedCount, setTraversedCount] = useState(0)      // live node count during scan
  const [incidentToast, setIncidentToast] = useState<IncidentToast | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showIncidentToast = useCallback((kind: 'added' | 'removed') => {
    api.health().then((h) => {
      const message = kind === 'added'
        ? `+1 incident added · ${h.incidents} total`
        : `−1 incident removed · ${h.incidents} total`
      setIncidentToast({ kind, message })
      if (toastTimer.current) clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setIncidentToast(null), 3500)
    }).catch(() => {})
  }, [])

  const clearRunbook = useCallback(() => {
    setRunbookSteps([])
    setRecallComplete(false)
  }, [])

  const resetGraph = useCallback(() => {
    setTraversedNodes(new Set())
    setHighlightedPath([])
    setDimNonPath(false)
    setAnimationMode('idle')
    setGraphPathReady(false)
    setTraversedCount(0)
    setRecallComplete(false)
    setRunbookSteps([])
    if (recallClearTimer.current) clearTimeout(recallClearTimer.current)
  }, [])

  const flashLifecycle = useCallback((stage: LifecycleStage) => {
    if (lifecycleTimer.current) clearTimeout(lifecycleTimer.current)
    setActiveLifecycle(stage)
    lifecycleTimer.current = setTimeout(() => setActiveLifecycle(null), 2500)
  }, [])

  const handleEvent = useCallback((event: GraphEvent) => {
    setLastEvent(event.event)

    switch (event.event) {

      // -----------------------------------------------------------------------
      // LEARN events — nodes + edges appear after cognify() completes
      // -----------------------------------------------------------------------

      case 'processing_start':
        setAnimationMode('learn')
        break

      case 'entity_found': {
        // During FEED: show heuristic nodes appearing live (glow animation)
        // Real graph refresh happens on remember_complete
        const newNode: GraphNode = {
          id: event.node.id,
          label: event.node.label,
          type: event.node.type,
          confidence: event.node.confidence,
          incident_count: event.node.incident_count,
        }
        setGraphData((prev) => {
          const exists = prev.nodes.some((n) => n.id === newNode.id)
          if (exists) return prev
          return { ...prev, nodes: [...prev.nodes, newNode] }
        })
        break
      }

      case 'relationship_found': {
        const newEdge: GraphEdge = {
          source: event.edge.source,
          target: event.edge.target,
          label: event.edge.label,
          weight: event.edge.weight,
        }
        setGraphData((prev) => {
          const exists = prev.links.some(
            (l) => l.source === newEdge.source && l.target === newEdge.target
          )
          if (exists) return prev
          return { ...prev, links: [...prev.links, newEdge] }
        })
        break
      }

      case 'remember_complete':
        flashLifecycle('remember')
        showIncidentToast('added')
        // Reload real Cognee graph after cognify completes — picks up new entities
        setTimeout(() => {
          api.getGraph().then((data) => {
            const nodes = (data.nodes as GraphNode[]) ?? []
            const links = (data.edges as GraphEdge[]) ?? []
            if (nodes.length > 0) setGraphData({ nodes, links })
          }).catch(() => {})
          setAnimationMode('idle')
        }, 1500)
        break

      // -----------------------------------------------------------------------
      // RECALL events — traversal animation
      // -----------------------------------------------------------------------

      case 'recall_start':
        setAnimationMode('recall')
        setTraversedNodes(new Set())
        setHighlightedPath([])
        setDimNonPath(false)
        setRunbookSteps([])
        setRecallComplete(false)
        setGraphPathReady(false)
        setTraversedCount(0)
        break

      case 'traversal_step':
        setTraversedNodes((prev) => new Set([...prev, event.node]))
        setTraversedCount((n) => n + 1)
        setDimNonPath(true)
        break

      case 'path_found':
        setHighlightedPath(event.path)
        setDimNonPath(true)
        setGraphPathReady(true)   // signal: traversal done, drawer can open
        break

      case 'runbook_step':
        setRunbookSteps((prev) => [
          ...prev,
          {
            step: event.step,
            description: event.text,
            command: event.command,
            confidence: event.confidence,
          },
        ])
        break

      case 'recall_complete':
        flashLifecycle('recall')
        setRecallComplete(true)
        // No auto-clear — highlights persist until user clicks "Reset Graph"
        break

      // -----------------------------------------------------------------------
      // IMPROVE events — edge weight + node pulse
      // -----------------------------------------------------------------------

      case 'edge_updated':
        // Update edge weight in graph data
        setGraphData((prev) => ({
          ...prev,
          links: prev.links.map((l) => {
            const edgeId = `${l.source}_${l.target}`.replace(/[^a-z0-9_]/g, '_')
            return edgeId.includes(event.edge.replace(/[^a-z0-9_]/g, '_'))
              ? { ...l, weight: event.weight }
              : l
          }),
        }))
        setAnimationMode('improve')
        break

      case 'node_pulse': {
        const nodeId = event.node
        const color = event.color
        setPulsingNodes((prev) => new Map([...prev, [nodeId, color]]))
        // Clear pulse after 1.5s
        setTimeout(() => {
          setPulsingNodes((prev) => {
            const next = new Map(prev)
            next.delete(nodeId)
            return next
          })
        }, 1500)
        break
      }

      case 'improve_complete':
        flashLifecycle('improve')
        setTimeout(() => {
          setAnimationMode('idle')
          setPulsingNodes(new Map())
        }, 800)
        break

      case 'forget_complete':
        flashLifecycle('forget')
        showIncidentToast('removed')
        // Reload graph from API — deleted incident's nodes may now be absent
        setTimeout(() => {
          api.getGraph().then((data) => {
            const nodes = (data.nodes as GraphNode[]) ?? []
            const links = (data.edges as GraphEdge[]) ?? []
            if (nodes.length > 0) setGraphData({ nodes, links })
          }).catch(() => {})
        }, 1200)
        break

      case 'error':
        console.error('[ws] Backend error:', event.message)
        break
    }
  }, [flashLifecycle])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      // Load the real Cognee knowledge graph on connect
      api.getGraph().then((data) => {
        const nodes = (data.nodes as GraphNode[]) ?? []
        const links = (data.edges as GraphEdge[]) ?? []
        if (nodes.length > 0) {
          setGraphData({ nodes, links })
        }
      }).catch(() => {/* backend may not be ready yet — ws events will build graph */})
    }

    ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as GraphEvent
        handleEvent(event)
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onclose = () => {
      setIsConnected(false)
      // Auto-reconnect
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [handleEvent])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      if (recallClearTimer.current) clearTimeout(recallClearTimer.current)
      if (lifecycleTimer.current) clearTimeout(lifecycleTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  // Keep WebSocket alive — send periodic ping
  useEffect(() => {
    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping')
      }
    }, 25000)
    return () => clearInterval(pingInterval)
  }, [])

  return {
    graphData,
    animationMode,
    traversedNodes,
    highlightedPath,
    dimNonPath,
    pulsingNodes,
    runbookSteps,
    recallComplete,
    isConnected,
    lastEvent,
    activeLifecycle,
    graphPathReady,
    traversedCount,
    incidentToast,
    clearRunbook,
    resetGraph,
  }
}
