import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  attachPhotos,
  fitWithin,
  formatBytes,
  photoQuality,
  readExifTakenAt,
  takenAtOfFile,
} from '@/utils/photo'

describe('photo size', () => {
  it('fits the longest edge into 4032 px in either orientation, keeping the ratio', () => {
    expect(fitWithin(8064, 6048)).toEqual({ width: 4032, height: 3024 })
    expect(fitWithin(6048, 8064)).toEqual({ width: 3024, height: 4032 })
    expect(fitWithin(5000, 5000)).toEqual({ width: 4032, height: 4032 })
  })

  it('never scales up', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 4032, height: 3024 })
    expect(fitWithin(1600, 1200)).toEqual({ width: 1600, height: 1200 })
  })

  it('never exceeds the limit through rounding', () => {
    const { width, height } = fitWithin(4033, 3999)
    expect(Math.max(width, height)).toBe(4032)
  })

  it.each([
    [
      'iPhone Safari',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      0.6,
    ],
    [
      'iPhone Chrome',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1',
      0.6,
    ],
    [
      'iPad desktop mode',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      0.6,
    ],
    [
      'Mac Safari',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      0.6,
    ],
    [
      'Mac Chrome',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      0.85,
    ],
    [
      'Android Chrome',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      0.85,
    ],
    [
      'Firefox desktop',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
      0.85,
    ],
  ])('picks the JPEG quality for %s', (_name, userAgent, quality) => {
    expect(photoQuality(userAgent)).toBe(quality)
  })

  it('writes file sizes with a decimal comma', () => {
    expect(formatBytes(400)).toBe('1 KB')
    expect(formatBytes(850_000)).toBe('850 KB')
    expect(formatBytes(3_240_000)).toBe('3,2 MB')
  })
})

describe('attaching several photos', () => {
  const files = ['a', 'b', 'c'].map((name) => new File([name], `${name}.jpg`))

  it('compresses and stores one file after the other, never two at once', async () => {
    const log: string[] = []
    let running = 0
    const compress = async (file: Blob) => {
      running++
      expect(running).toBe(1)
      log.push(`compress ${(file as File).name}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return file
    }
    const result = await attachPhotos(
      files,
      (photo) => void log.push(`add ${(photo as File).name}`),
      compress,
    )

    expect(result).toEqual({ skipped: 0 })
    expect(log).toEqual([
      'compress a.jpg',
      'add a.jpg',
      'compress b.jpg',
      'add b.jpg',
      'compress c.jpg',
      'add c.jpg',
    ])
  })

  it('skips a file that cannot be decoded and attaches the rest', async () => {
    const added: string[] = []
    const compress = async (file: Blob) => {
      if ((file as File).name === 'b.jpg') {
        throw new Error('cannot decode')
      }
      return file
    }
    const result = await attachPhotos(
      files,
      (photo) => void added.push((photo as File).name),
      compress,
    )
    expect(result).toEqual({ skipped: 1 })
    expect(added).toEqual(['a.jpg', 'c.jpg'])
  })

  it('stops at a failed store and keeps the photos stored before', async () => {
    const added: string[] = []
    const add = (photo: Blob) => {
      if ((photo as File).name === 'b.jpg') {
        throw new Error('storage full')
      }
      added.push((photo as File).name)
    }
    await expect(attachPhotos(files, add, async (file) => file)).rejects.toThrow('storage full')
    expect(added).toEqual(['a.jpg'])
  })
})

/**
 * A JPEG with nothing but the Exif segment: start of image, APP1 with DateTimeOriginal (and a decoy date in the first directory), end.
 * `little` chooses the byte order of the TIFF part (iPhones write big endian, many Androids little endian).
 */
function jpegWithExif(taken: string, little: boolean, before: number[][] = []): File {
  const u16 = (n: number) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255])
  const u32 = (n: number) =>
    little
      ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >> 24]
      : [n >> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]
  const text = [...taken].map((c) => c.charCodeAt(0)).concat(0)
  // TIFF: header (8), first directory with the pointer to the Exif directory, Exif directory with DateTimeOriginal, the text
  const ifd0 = 8
  const exif = ifd0 + 2 + 12 + 4
  const textAt = exif + 2 + 12 + 4
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(ifd0),
    ...u16(1),
    ...u16(0x8769),
    ...u16(4),
    ...u32(1),
    ...u32(exif),
    ...u32(0),
    ...u16(1),
    ...u16(0x9003),
    ...u16(2),
    ...u32(20),
    ...u32(textAt),
    ...u32(0),
    ...text,
  ]
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const app1 = [0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body]
  const bytes = [0xff, 0xd8, ...before.flat(), ...app1, 0xff, 0xd9]
  return new File([new Uint8Array(bytes)], 'p.jpg', {
    type: 'image/jpeg',
    lastModified: Date.UTC(2026, 10, 19),
  })
}
// A segment before the Exif one, as cameras write a JFIF header
const JFIF = [[0xff, 0xe0, 0, 4, 0, 0]]

describe('capture time of a library photo', () => {
  it.each([
    ['big endian', false],
    ['little endian', true],
  ])('reads DateTimeOriginal as the time on the device (%s)', async (_name, little) => {
    const taken = await readExifTakenAt(jpegWithExif('2026:11:13 09:15:42', little))
    expect(taken).toEqual(new Date(2026, 10, 13, 9, 15, 42))
  })

  it('finds the Exif segment behind another one', async () => {
    const taken = await readExifTakenAt(jpegWithExif('2026:11:13 09:15:42', false, JFIF))
    expect(taken).toEqual(new Date(2026, 10, 13, 9, 15, 42))
  })

  it('has no time for a file without Exif data, one that is no JPEG, an empty one and an impossible date', async () => {
    const plain = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9])], 'p.jpg')
    expect(await readExifTakenAt(plain)).toBeNull()
    expect(await readExifTakenAt(new File(['not an image'], 'p.txt'))).toBeNull()
    expect(await readExifTakenAt(new File([], 'p.jpg'))).toBeNull()
    expect(await readExifTakenAt(jpegWithExif('0000:00:00 00:00:00', false))).toBeNull()
    expect(await readExifTakenAt(jpegWithExif('2026:13:45 25:61:61', false))).toBeNull()
  })

  it('has no time for a damaged file, cut off in the middle of the Exif data', async () => {
    const whole = jpegWithExif('2026:11:13 09:15:42', false)
    for (const length of [3, 12, 30, 45, 60]) {
      expect(await readExifTakenAt(whole.slice(0, length))).toBeNull()
    }
    const garbage = new File(
      [
        new Uint8Array([
          0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 42, 0xff,
          0xff, 0xff, 0xff,
        ]),
      ],
      'p.jpg',
    )
    expect(await readExifTakenAt(garbage)).toBeNull()
  })

  it('reads the time of the test photo of the browser tests', async () => {
    const bytes = readFileSync('e2e/fixtures/photo-2.jpg')
    expect(await readExifTakenAt(new File([new Uint8Array(bytes)], 'photo-2.jpg'))).toEqual(
      new Date(2026, 10, 13, 9, 15, 42),
    )
  })

  it('takes the capture time, else the time the file was changed, else now', async () => {
    expect(await takenAtOfFile(jpegWithExif('2026:11:13 09:15:42', false))).toEqual(
      new Date(2026, 10, 13, 9, 15, 42),
    )

    const noExif = new File(['x'], 'p.jpg', { lastModified: Date.UTC(2026, 10, 2, 8) })
    expect(await takenAtOfFile(noExif)).toEqual(new Date(Date.UTC(2026, 10, 2, 8)))

    const before = Date.now()
    const none = await takenAtOfFile(new File(['x'], 'p.jpg', { lastModified: 0 }))
    expect(none.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('is handed to the photo only when asked for, before the file is compressed', async () => {
    const files = [new File(['a'], 'a.jpg'), new File(['b'], 'b.jpg')]
    const log: string[] = []
    const takenAtOf = async (file: File) => (
      log.push(`time ${file.name}`),
      new Date(file.name === 'a.jpg' ? 1000 : 2000)
    )
    const compress = async (file: Blob) => (log.push(`compress ${(file as File).name}`), file)
    const added: (Date | undefined)[] = []

    await attachPhotos(files, (_photo, takenAt) => void added.push(takenAt), compress, takenAtOf)
    expect(added).toEqual([new Date(1000), new Date(2000)])
    expect(log).toEqual(['time a.jpg', 'compress a.jpg', 'time b.jpg', 'compress b.jpg'])

    added.length = 0
    await attachPhotos(files, (_photo, takenAt) => void added.push(takenAt), compress)
    expect(added).toEqual([undefined, undefined])
  })
})
