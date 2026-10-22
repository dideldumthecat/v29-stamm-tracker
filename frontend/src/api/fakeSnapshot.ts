/**
 * FAKE DATA – stands in for the snapshot the API will deliver.
 * Attribute names and options are content maintained by V29; they only appear here
 * as test data and must never be referenced by id or label in application code.
 */
import type { Attribute, TimberItem } from '@/stores/timberItems'

export const FAKE_CURRENT_USER_NAME = 'Alexander'

export const fakeAttributes: Attribute[] = [
  {
    id: 'attr-wood-species',
    name: 'Holzart',
    type: 'choice',
    options: [
      { id: 'opt-sessile-oak', label: 'Traubeneiche' },
      { id: 'opt-pedunculate-oak', label: 'Stieleiche' },
      { id: 'opt-red-oak', label: 'Roteiche' },
    ],
  },
]

export const fakeTimberItems: TimberItem[] = [
  {
    id: 'item-123',
    tagNumber: 123,
    createdAt: '2026-10-02T09:12:00',
    createdBy: 'Kerstin',
    values: {
      'attr-wood-species': {
        optionId: 'opt-sessile-oak',
        recordedAt: '2026-10-02T09:12:00',
        recordedBy: 'Kerstin',
      },
    },
  },
  {
    // Known timber item without any recorded value yet.
    id: 'item-456',
    tagNumber: 456,
    createdAt: '2026-10-08T14:30:00',
    createdBy: 'Kerstin',
    values: {},
  },
]
