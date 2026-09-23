import type { BarcodeScanner, ScanRegion } from './BarcodeScanner'

declare class BarcodeDetector {
  constructor(options?: { formats: string[] })
  detect(image: CanvasImageSource): Promise<Array<{ rawValue: string }>>
}

// ponytail: ean_13/upc_a nur für den manuellen Kamera-Test mit Alltagsobjekten (z.B. Wasserflasche),
// da echte Plaketten Code 39/128/Data Matrix tragen. Vor dem MVP wieder auf die drei Kandidaten reduzieren.
const FORMATS = ['code_39', 'code_128', 'data_matrix', 'ean_13', 'upc_a']

export class NativeScanner implements BarcodeScanner {
  private detector: BarcodeDetector
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D

  constructor() {
    this.detector = new BarcodeDetector({ formats: FORMATS })
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
    const results = await this.detector.detect(this.canvas)
    return results[0]?.rawValue ?? null
  }
}
