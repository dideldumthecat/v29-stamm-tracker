import { describe, it, expect } from 'vitest'
import { extractInviteCode } from '@/utils/invite'

describe('extractInviteCode', () => {
  it.each([
    ['bare code', 'K7QM-4XHT-9RDP', 'K7QM-4XHT-9RDP'],
    ['lower case with spaces', '  k7qm 4xht 9rdp ', 'k7qm 4xht 9rdp'],
    ['without hyphens', 'k7qm4xht9rdp', 'k7qm4xht9rdp'],
    [
      'whole message with link',
      'Hallo Jana, dein Zugang: https://v29.example/invite#K7QM-4XHT-9RDP – viel Spaß',
      'K7QM-4XHT-9RDP',
    ],
    [
      'link with trailing full stop',
      'Hier: https://v29.example/invite#K7QM-4XHT-9RDP.',
      'K7QM-4XHT-9RDP',
    ],
    ['link with glued dash', 'https://v29.example/invite#K7QM-4XHT-9RDP–danke', 'K7QM-4XHT-9RDP'],
    ['link in brackets', '(https://v29.example/invite#k7qm-4xht-9rdp)', 'k7qm-4xht-9rdp'],
    [
      'link wrapped onto a new line',
      'Dein Zugang:\nhttps://v29.example/invite#K7QM-4XHT-9RDP\n\nGruß',
      'K7QM-4XHT-9RDP',
    ],
    ['code in a sentence', 'Dein Code ist k7qm-4xht-9rdp, viel Spaß!', 'k7qm-4xht-9rdp'],
    [
      'invisible marks and protected spaces',
      '\u200E\u2068K7QM\u20114XHT\u00AD-9RDP\u2069\u00A0',
      'K7QM-4XHT-9RDP',
    ],
    ['minus sign and en dash', 'K7QM\u22124XHT–9RDP', 'K7QM-4XHT-9RDP'],
    ['printed form beats a 12-letter word', 'Kennzeichnen: K7QM-4XHT-9RDP', 'K7QM-4XHT-9RDP'],
  ])('%s', (_, pasted, expected) => {
    expect(extractInviteCode(pasted)).toBe(expected)
  })

  it.each([
    ['empty', ''],
    ['plain greeting', 'Hallo Jana, viel Spaß beim Erfassen!'],
    ['too short', 'K7QM-4XHT'],
    ['letter U is not in the alphabet', 'K7QM-4XHT-9RDU'],
  ])('finds nothing: %s', (_, pasted) => {
    expect(extractInviteCode(pasted)).toBeNull()
  })
})
