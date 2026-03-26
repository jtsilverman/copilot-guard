export interface FileExposure {
  uri: string
  fileName: string
  language: string
  openedAt: number
  lastEditedAt: number | null
  visibleRanges: { start: number; end: number }[]
  lineCount: number
  sensitivityLevel: SensitivityLevel
  sensitivityReason?: string
}

export type SensitivityLevel = 'safe' | 'warning' | 'danger'

export interface SessionStats {
  startTime: number
  filesExposed: number
  sensitiveFilesExposed: number
  estimatedTokens: number
  warnings: number
}

export interface DashboardData {
  status: SensitivityLevel
  exposures: FileExposure[]
  stats: SessionStats
}
