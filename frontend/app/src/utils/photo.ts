import { PHOTO_MAX_EDGE, PHOTO_QUALITY_APPLE, PHOTO_QUALITY_DEFAULT } from '@/config/constants'

/** Size that fits the longest edge into `maxEdge`, keeping the ratio. Never scales up. */
export function fitWithin(width: number, height: number, maxEdge = PHOTO_MAX_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * JPEG quality for the encoder behind the user agent. WebKit on iOS is the only engine here that uses Apple's
 * encoder (all iOS browsers, Safari on the Mac, iPad in desktop mode); Chrome-based browsers also say "AppleWebKit".
 */
export function photoQuality(userAgent: string): number {
  const apple = /AppleWebKit/.test(userAgent) && !/Chrome|Chromium|Android/.test(userAgent)
  return apple ? PHOTO_QUALITY_APPLE : PHOTO_QUALITY_DEFAULT
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
        photoQuality(navigator.userAgent),
      ),
    )
  } finally {
    bitmap.close()
  }
}

/**
 * The capture time (DateTimeOriginal) of a JPEG from its EXIF data, or null if the file has none or is not readable.
 * Compression drops EXIF, so this has to read the original. The time has no time zone: it is taken as the time on this device.
 * Only JPEG is read (the picker hands HEIC over as JPEG on iPhones); anything else counts as "no time".
 * A small parser instead of a library: the offline cache holds every byte of the app, and one tag is all that is needed.
 */
export async function readExifTakenAt(file: Blob): Promise<Date | null> {
  try {
    // The Exif segment follows the start of the file; its length is at most 64 KB.
    const view = new DataView(await file.slice(0, 256 * 1024).arrayBuffer())
    if (view.getUint16(0) !== 0xffd8) return null
    let pos = 2
    while (pos + 4 <= view.byteLength && view.getUint8(pos) === 0xff) {
      const marker = view.getUint8(pos + 1)
      // Start of the image data or its end: no Exif segment came before
      if (marker === 0xda || marker === 0xd9) return null
      // "Exif\0\0" opens the TIFF structure of an APP1 segment
      if (
        marker === 0xe1 &&
        view.getUint32(pos + 4) === 0x45786966 &&
        view.getUint16(pos + 8) === 0
      ) {
        return exifDate(view, pos + 10)
      }
      pos += 2 + view.getUint16(pos + 2)
    }
  } catch {
    // Cut off or damaged: no time
  }
  return null
}

/** DateTimeOriginal (tag 0x9003) in the Exif part (pointer 0x8769 of the first directory) of the TIFF structure at `tiff`. */
function exifDate(view: DataView, tiff: number): Date | null {
  const byteOrder = view.getUint16(tiff)
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null
  const little = byteOrder === 0x4949
  if (view.getUint16(tiff + 2, little) !== 42) return null
  const valueOf = (directory: number, tag: number): number | null => {
    const count = view.getUint16(tiff + directory, little)
    for (let i = 0; i < count; i++) {
      const entry = tiff + directory + 2 + i * 12
      if (view.getUint16(entry, little) === tag) return view.getUint32(entry + 8, little)
    }
    return null
  }
  const exifDirectory = valueOf(view.getUint32(tiff + 4, little), 0x8769)
  if (exifDirectory === null) return null
  // 19 characters "2026:11:13 09:15:42" (the value is longer than 4 bytes, so the entry holds its offset)
  const offset = valueOf(exifDirectory, 0x9003)
  if (offset === null) return null
  let text = ''
  for (let i = 0; i < 19; i++) text += String.fromCharCode(view.getUint8(tiff + offset + i))
  const [year, month, day, hour, minute, second] =
    text
      .match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
      ?.slice(1)
      .map(Number) ?? []
  if (year === undefined) return null
  const date = new Date(year, month - 1, day, hour, minute, second)
  // "0000:00:00 00:00:00" and other impossible dates roll over into another day: not a time
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null
}

/**
 * When a photo from the library was taken: the EXIF capture time, else the time the file was last changed, else now.
 * Must run before `compressPhoto`, which drops the EXIF data.
 */
export async function takenAtOfFile(file: File): Promise<Date> {
  return (
    (await readExifTakenAt(file)) ??
    (file.lastModified > 0 ? new Date(file.lastModified) : new Date())
  )
}

interface PhotoOptions {
  compress?: (file: Blob) => Promise<Blob>
  takenAtOf?: (file: File) => Promise<Date>
}

/**
 * Compresses and hands over the files one after another (a phone does not hold several 12-megapixel images at once).
 * `add` stores each photo before the next file is read, so a failure keeps what was done so far.
 * A file the browser cannot decode (HEIC on some Android phones) is skipped and counted.
 * With `takenAtOf` (library photos) the time is read from the original first and handed to `add`; without it (the camera) `add` gets none.
 */
export async function attachPhotos(
  files: File[],
  add: (photo: Blob, takenAt?: Date) => void | Promise<void>,
  { compress = compressPhoto, takenAtOf }: PhotoOptions = {},
): Promise<{ skipped: number }> {
  let skipped = 0
  for (const file of files) {
    let photo: Blob
    let takenAt: Date | undefined
    try {
      takenAt = await takenAtOf?.(file)
      photo = await compress(file)
    } catch {
      skipped++
      continue
    }
    await add(photo, takenAt)
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
