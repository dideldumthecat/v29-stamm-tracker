import { readBarcodes, type ReaderOptions } from 'zxing-wasm/reader'
import type { BarcodeScanner, ScanRegion } from './BarcodeScanner'

// ponytail: EAN13/UPCA nur für den manuellen Kamera-Test mit Alltagsobjekten (z.B. Wasserflasche),
// da echte Plaketten Code 39/128/Data Matrix tragen. Vor dem MVP wieder auf die drei Kandidaten reduzieren.
const READER_OPTIONS: ReaderOptions = {
  formats: ['Code39', 'Code128', 'DataMatrix', 'EAN13', 'UPCA'],
  maxNumberOfSymbols: 1,
}

export class ZxingScanner implements BarcodeScanner {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D

  constructor() {
    this.canvas = document.createElement('canvas')
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
  }

  async scan(video: HTMLVideoElement, region: ScanRegion): Promise<string | null> {
    if (this.canvas.width !== region.width || this.canvas.height !== region.height) {
      this.canvas.width = region.width
      this.canvas.height = region.height
    }
    this.ctx.drawImage(video, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height)
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)
    const results = await readBarcodes(imageData, READER_OPTIONS)
    return results[0]?.text ?? null
  }
}
