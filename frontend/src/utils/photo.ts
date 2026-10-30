import { PHOTO_MAX_EDGE, PHOTO_QUALITY } from '@/config/constants'

/** Size that fits the longest edge into `maxEdge`, keeping the ratio. Never scales up. */
export function fitWithin(width: number, height: number, maxEdge = PHOTO_MAX_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * The camera's file as the JPEG that gets stored and uploaded: orientation applied, longest edge at most
 * PHOTO_MAX_EDGE, no EXIF (the canvas drops it). The server stores the file unchanged, so this is the only compression.
 */
export async function compressPhoto(file: Blob): Promise<Blob> {
  // Without "from-image" some browsers ignore the EXIF rotation and the photo ends up sideways.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Photo could not be encoded'))),
        'image/jpeg',
        PHOTO_QUALITY,
      ),
    )
  } finally {
    bitmap.close()
  }
}

/**
 * Compresses and hands over the files one after another (a phone does not hold several 12-megapixel images at once).
 * `add` stores each photo before the next file is read, so a failure keeps what was done so far.
 * A file the browser cannot decode (HEIC on some Android phones) is skipped and counted.
 */
export async function attachPhotos(
  files: File[],
  add: (photo: Blob) => void | Promise<void>,
  compress: (file: Blob) => Promise<Blob> = compressPhoto,
): Promise<{ skipped: number }> {
  let skipped = 0
  for (const file of files) {
    let photo: Blob
    try {
      photo = await compress(file)
    } catch {
      skipped++
      continue
    }
    await add(photo)
  }
  return { skipped }
}

/** "850 KB", "3,2 MB": decimal comma as V29 writes it. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) {
    return `${Math.max(1, Math.round(bytes / 1000))} KB`
  }
  return `${(bytes / 1_000_000).toFixed(1).replace('.', ',')} MB`
}
