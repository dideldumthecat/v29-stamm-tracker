export interface ScanRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface BarcodeScanner {
  scan(video: HTMLVideoElement, region: ScanRegion): Promise<string | null>
}
