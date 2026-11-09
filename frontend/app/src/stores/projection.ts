/**
 * Displayed state = stored snapshot (as the server sent it) + own pending events laid over it.
 * Pure functions, so the rules can be tested without the store.
 *
 * `projectItems` keeps own values only; inherited values are added at read time (`withInherited`).
 */
import type { Attribute, Event, Snapshot, TimberItem, Uuid } from '@v29/shared/contract'
import { isInheritedValue, lastEventId } from '@v29/shared/attributes'
import { nextBeamTag } from '@/utils/tag'

const findById = (items: TimberItem[], id: string | null) => items.find((item) => item.id === id)

// Copies, so the snapshot itself stays untouched. currentUserId: own pending events are not on the server yet.
export function projectItems(
  snapshot: Snapshot,
  events: Event[],
  attributes: Attribute[],
  currentUserId: string,
): TimberItem[] {
  const byId = new Map(
    snapshot.timber_items.map((item) => [item.id, { ...item, values: { ...item.values } }]),
  )
  // The snapshot delivers beams with their inherited values (as timber_item_state does).
  // Strip those, so a parent changed offline is followed by its beams.
  for (const item of byId.values()) {
    const parent = item.parent_id ? byId.get(item.parent_id) : undefined
    for (const attributeId of Object.keys(item.values)) {
      const own = lastEventId(item.values[attributeId])
      if (parent && own !== undefined && own === lastEventId(parent.values[attributeId])) {
        delete item.values[attributeId]
      }
    }
  }

  const stemsWithRemovedBeam = new Set<Uuid>()
  for (const event of events) {
    if (event.type === 'voided') {
      // Gone at once, like on the server after the sync; its letter is free again.
      const beam = byId.get(event.timber_item_id)
      byId.delete(event.timber_item_id)
      if (beam?.parent_id) {
        stemsWithRemovedBeam.add(beam.parent_id)
      }
      continue
    }
    if (event.type === 'created') {
      const parentId = event.data.parent_id
      byId.set(event.timber_item_id, {
        id: event.timber_item_id,
        parent_id: parentId,
        tag_number: null,
        has_children: false,
        created_at: event.recorded_at,
        created_by: currentUserId,
        values: {},
      })
      const parent = parentId ? byId.get(parentId) : undefined
      if (parent) {
        parent.has_children = true
      }
      continue
    }
    // Voided on the server meanwhile: nothing to show it on.
    const item = byId.get(event.timber_item_id)
    if (!item) {
      continue
    }
    if (event.type === 'tag_assigned') {
      item.tag_number = event.data.tag_number
      continue
    }
    const { attribute_id: attributeId, value } = event.data
    const record = {
      value,
      recorded_at: event.recorded_at,
      user_id: currentUserId,
      event_id: event.id,
    }
    // Series keep every recording; all other attributes hold exactly one (the current value).
    const isSeries = attributes.find((attribute) => attribute.id === attributeId)?.is_series
    item.values[attributeId] = isSeries ? [...(item.values[attributeId] ?? []), record] : [record]
  }
  // A stem whose last beam is removed is editable again, also offline (the server does the same).
  for (const stemId of stemsWithRemovedBeam) {
    const stem = byId.get(stemId)
    if (stem) {
      stem.has_children = [...byId.values()].some((item) => item.parent_id === stemId)
    }
  }
  return [...byId.values()]
}

// Synced beams the user removed and the sync has not sent yet: gone from the items, but the sync screen still names them.
export function removedBeams(snapshot: Snapshot, events: Event[]): Map<Uuid, TimberItem> {
  return new Map(
    events
      .filter((event) => event.type === 'voided')
      .flatMap((event) => {
        const beam = snapshot.timber_items.find((item) => item.id === event.timber_item_id)
        return beam ? [[beam.id, beam] as const] : []
      }),
  )
}

// Same rules as the server projection: inheritable attributes come from the parent unless the
// beam has its own value; a series is taken as a whole list, never merged.
export function withInherited(
  item: TimberItem,
  items: TimberItem[],
  attributes: Attribute[],
): TimberItem {
  const parent = findById(items, item.parent_id)
  if (!parent) {
    return item
  }
  const inherited = attributes
    .filter((attribute) => attribute.is_inheritable && parent.values[attribute.id])
    .map((attribute) => [attribute.id, parent.values[attribute.id]!])
  return { ...item, values: { ...Object.fromEntries(inherited), ...item.values } }
}

// Inherited = the beam shows the very recording its parent holds.
export function isInherited(
  itemId: string,
  attributeId: string,
  items: TimberItem[],
  attributes: Attribute[],
): boolean {
  const item = findById(items, itemId)
  const parent = item && findById(items, item.parent_id)
  if (!item || !parent) {
    return false
  }
  return isInheritedValue(withInherited(item, items, attributes), parent, attributeId)
}

// Sorted by tag like the Excel export: the snapshot order is device time, which skews between phones.
// Beams without a tag come last.
export function childrenOf(
  itemId: string,
  items: TimberItem[],
  attributes: Attribute[],
): TimberItem[] {
  return items
    .filter((item) => item.parent_id === itemId)
    .map((item) => withInherited(item, items, attributes))
    .sort(
      (a, b) =>
        Number(a.tag_number === null) - Number(b.tag_number === null) ||
        (a.tag_number ?? '').localeCompare(b.tag_number ?? ''),
    )
}

// Undefined parent = stem not created yet, so no beams either. A removed beam frees its letter.
// draftTags: beams of a draft that is not saved yet; they count, so a letter once shown is never handed out twice.
export function nextBeamTagOf(
  parent: TimberItem | undefined,
  parentTag: string,
  items: TimberItem[],
  draftTags: string[] = [],
): string | null {
  const beamTags = parent
    ? items.filter((item) => item.parent_id === parent.id).map((beam) => beam.tag_number)
    : []
  return nextBeamTag(parentTag, [...beamTags, ...draftTags])
}
