import { describe, it, expect } from 'vitest'
import { formatInviteInput, isInviteCode } from '../invite'

describe('formatInviteInput', () => {
  it.each([
    ['empty', '', ''],
    ['first group', 'k7qm', 'K7QM'],
    ['hyphen before the next group', 'k7qm4', 'K7QM-4'],
    ['full code', 'k7qm4xht9rdp', 'K7QM-4XHT-9RDP'],
    ['typed hyphens and spaces', 'k7qm--4xht 9rdp', 'K7QM-4XHT-9RDP'],
    ['dashes from a messenger', 'K7QM–4XHT−9RDP', 'K7QM-4XHT-9RDP'],
    ['nothing beyond twelve characters', 'K7QM-4XHT-9RDPX', 'K7QM-4XHT-9RDP'],
    ['backspace after a hyphen', 'K7QM-', 'K7QM'],
  ])('%s', (_, typed, expected) => {
    expect(formatInviteInput(typed)).toBe(expected)
  })
})

describe('isInviteCode', () => {
  it.each([
    ['printed form', 'K7QM-4XHT-9RDP', true],
    ['look-alike letters', 'K7QM-4XHT-9RDO', true],
    ['too short', 'K7QM-4XHT', false],
    ['letter U is not in the alphabet', 'K7QM-4XHT-9RDU', false],
  ])('%s', (_, text, expected) => {
    expect(isInviteCode(text)).toBe(expected)
  })
})
