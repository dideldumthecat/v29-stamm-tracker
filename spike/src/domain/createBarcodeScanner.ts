import type { BarcodeScanner } from './BarcodeScanner'
import { NativeScanner } from './NativeScanner'
import { ZxingScanner } from './ZxingScanner'

export function createBarcodeScanner(): BarcodeScanner {
  return 'BarcodeDetector' in window ? new NativeScanner() : new ZxingScanner()
}
