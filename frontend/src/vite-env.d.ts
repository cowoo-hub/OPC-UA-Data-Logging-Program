/// <reference types="vite/client" />

interface DesktopCsvSaveResult {
  saved: boolean
  cancelled: boolean
  path: string | null
  error: string | null
}

interface PywebviewDesktopApi {
  save_csv_file?: (
    suggestedFilename: string,
    content: string,
  ) => Promise<DesktopCsvSaveResult>
}

interface Window {
  pywebview?: {
    api?: PywebviewDesktopApi
  }
}
