/**
 * API contract between the capture app and the Symfony API (schema_version 1).
 *
 * Describes the JSON exactly as it travels over the wire: snake_case keys, timestamps as
 * ISO 8601 in UTC with milliseconds ("2026-10-22T09:41:10.000Z"), dates without time ("2026-09-28").
 * Examples: ./fixtures/*.json – the backend uses the same files as test expectations.
 *
 * These types are a promise, not a check: TypeScript does not validate responses at runtime.
 * The API module is the only place that touches these shapes; the store gets app models.
 */

export type Uuid = string
/** ISO 8601 timestamp in UTC with milliseconds, as Date#toISOString() writes it: "2026-10-22T09:41:10.000Z". */
export type Timestamp = string
/** Calendar date without time, e.g. "2026-09-28". */
export type CalendarDate = string
/** Calendar month without day, e.g. "2026-10". */
export type CalendarMonth = string

// --- Status codes (all endpoints) ---------------------------------------------
// 200 OK
// 401 invite link unknown or revoked → app shows "Kein Zugang" (sitemap)
// 400 malformed request (bug in the app, not a user error)
// 5xx / network error → sync failed, events stay in the local queue
// Photo upload follows with the photo feature (not part of the MVP).

// --- POST /api/session ------------------------------------------------------
// Called once when the invite link is opened. Request: { "token": "<from the link>" }.
// The server sets the session cookie; every later request is attributed via that cookie,
// so the app never sends a user id itself.

export interface SessionResponse {
  /** Stored on the device. Needed to attribute own pending events before the server sets user_id. */
  user: { id: Uuid; name: string }
}

// --- GET /api/snapshot -------------------------------------------------------

export interface Snapshot {
  schema_version: 1
  /** Server time the snapshot was built. Not "last synced" – that is client time after a successful sync. */
  generated_at: Timestamp
  /** Names for "recorded by …", own name included (looked up via the id from the session). Never tokens or revocation state. */
  users: { id: Uuid; name: string }[]
  /** Includes inactive attributes and options: old values must still be displayable. */
  attributes: Attribute[]
  /** Voided items are not included. */
  timber_items: TimberItem[]
}

export type AttributeType = 'boolean' | 'choice' | 'number' | 'text' | 'date' | 'month' | 'photo'

export interface Attribute {
  id: Uuid
  name: string
  description: string
  type: AttributeType
  /** Only set for type "number", otherwise null. */
  unit: string | null
  is_series: boolean
  is_inheritable: boolean
  sort_order: number
  active: boolean
  /** Only filled for type "choice", otherwise empty. */
  options: AttributeOption[]
}

export interface AttributeOption {
  id: Uuid
  label: string
  sort_order: number
  active: boolean
}

export interface TimberItem {
  id: Uuid
  /** Set for beams: the timber item they were cut from. */
  parent_id: Uuid | null
  /** Latest tag ("123", beams "123-A"). Without leading zeros, not unique, null if none assigned yet. */
  tag_number: string | null
  /** Split into beams: the app records nothing more on it; the server still accepts late events from other devices. */
  has_children: boolean
  created_at: Timestamp
  created_by: Uuid
  /**
   * Current values keyed by attribute id, as in the server projection timber_item_state:
   * own values plus values inherited from the parent.
   * Always an array, oldest first: series (is_series) carry every recording,
   * all other attributes exactly one (the current value).
   */
  values: Record<Uuid, AttributeValueRecord[]>
}

export interface AttributeValueRecord {
  value: AttributeValue
  recorded_at: Timestamp
  user_id: Uuid
  /** Event that produced this value – target for corrections and voids in the administration. */
  event_id: Uuid
}

/** boolean → true/false, choice → option id (never the label), number → number,
 *  text → string, date → CalendarDate, month → CalendarMonth, photo → photo id. */
export type AttributeValue = boolean | number | string

// --- POST /api/sync ----------------------------------------------------------

export interface SyncRequest {
  /** In the order they were recorded. Resending is harmless: the server ignores known event ids. */
  events: Event[]
}

export interface SyncResponse {
  /** Includes ids the server already knew. Only these may leave the local queue. */
  accepted_event_ids: Uuid[]
  /**
   * Events the server will never store, one entry per event (kept server-side in rejected_syncs).
   * They leave the queue as well; the app drops the items they belong to.
   */
  rejected: RejectedEvent[]
}

/**
 * tag_already_taken: the item was created with a tag (its first tag_assigned in the request) that another
 * item already holds – a duplicate capture. All events of that item and of its beams in the request are rejected.
 */
export interface RejectedEvent {
  event_id: Uuid
  timber_item_id: Uuid
  /** The tag that is taken; for beams of a rejected item the tag of that item. */
  tag_number: string
  reason: 'tag_already_taken'
}

interface EventBase {
  /** Generated on the device (crypto.randomUUID()). */
  id: Uuid
  schema_version: 1
  timber_item_id: Uuid
  /** Device time. received_at and user_id are set by the server, never sent. */
  recorded_at: Timestamp
}

export type Event =
  | (EventBase & { type: 'created'; data: { parent_id: Uuid | null } })
  | (EventBase & { type: 'tag_assigned'; data: { tag_number: string } })
  | (EventBase & {
      type: 'attribute_recorded'
      data: { attribute_id: Uuid; value: AttributeValue }
    })
// corrected and voided are created in the administration only and never sent by the app.
