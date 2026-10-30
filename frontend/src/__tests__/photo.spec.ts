import { describe, it, expect } from 'vitest'
import { attachPhotos, fitWithin, formatBytes } from '@/utils/photo'

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
    const { width, height } = fitWithin(4033, 2999)
    expect(Math.max(width, height)).toBe(4032)
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
