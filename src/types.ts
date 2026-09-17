export type Language = 'en' | 'pt'
export type AgentStatus = 'working' | 'reviewing' | 'waiting' | 'approved' | 'idle'

export interface Agent {
  id: string
  icon: string
  nameKey: string
  roomKey: string
  taskKey: string
  asset: string
  status: AgentStatus
  detailKey: string
  lastKey: string
  startedAt: string
  ollama: boolean
  gridArea: string
}
