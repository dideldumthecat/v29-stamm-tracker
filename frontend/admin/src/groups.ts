import type { Uuid } from '@v29/shared/contract'
import type { AdminAttribute, AdminGroup, AdminGroupInput } from '@/api/contract'

import { KIND_LABELS, TYPE_LABELS } from '@/attributes'

/** "Alle" or "12 von 14": what the list shows under "Merkmale in der App". */
export const attributesText = (group: AdminGroup, total: number) =>
  group.sees_all_attributes ? 'Alle' : `${group.attribute_ids.length} von ${total}`

/** The line under the name in the checklist: "Zahl (%) · Balken · mehrere Werte". A photo is always a series, which says nothing. */
export const attributeMeta = (attribute: AdminAttribute) =>
  [
    TYPE_LABELS[attribute.type] + (attribute.unit ? ` (${attribute.unit})` : ''),
    attribute.applies_to.map((kind) => KIND_LABELS[kind]).join(', '),
    ...(attribute.is_series && attribute.type !== 'photo' ? ['mehrere Werte'] : []),
    ...(attribute.active ? [] : ['inaktiv']),
  ].join(' · ')

/** The group the server gives a new user without a word from the administration: the one named "V29" that sees all, else the first. */
export const defaultGroup = (groups: AdminGroup[]): AdminGroup | undefined =>
  groups.find((group) => group.name === 'V29' && group.sees_all_attributes) ?? groups[0]

/** What the card holds: the name as typed and the choice of the attributes, which is kept while the radio switches back and forth. */
export interface GroupDraft {
  name: string
  seesAll: boolean
  selected: Uuid[]
}

export const draftOf = (group: AdminGroup): GroupDraft => ({
  name: group.name,
  seesAll: group.sees_all_attributes,
  selected: [...group.attribute_ids],
})

/** A new group starts with "Nur ausgewählte" and nothing selected. */
export const newDraft = (): GroupDraft => ({ name: '', seesAll: false, selected: [] })

export const isChanged = (group: AdminGroup, draft: GroupDraft) =>
  draft.name.trim() !== group.name ||
  draft.seesAll !== group.sees_all_attributes ||
  (!draft.seesAll &&
    (draft.selected.length !== group.attribute_ids.length ||
      draft.selected.some((id) => !group.attribute_ids.includes(id))))

export const bodyOf = (draft: GroupDraft): AdminGroupInput => ({
  name: draft.name,
  sees_all_attributes: draft.seesAll,
  attribute_ids: draft.seesAll ? [] : draft.selected,
})
