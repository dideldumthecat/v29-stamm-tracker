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
// 401 invite code unknown or revoked → app shows "Kein Zugang" (sitemap)
// 400 malformed request (bug in the app, not a user error)
// 5xx / network error → sync failed, events stay in the local queue
// 413 photo larger than 10 MB, 415 photo is not a JPEG (POST /api/photos only)
// 401 also applies to POST /api/photos and GET /api/photos/{id}.

// --- POST /api/session ------------------------------------------------------
// Called once when the invite code is entered. Request: { "token": "<the code>" }.
// The server sets the session cookie; every later request is attributed via that cookie,
// so the app never sends a user id itself.

export interface SessionResponse {
  /** Stored on the device. Needed to attribute own pending events before the server sets user_id. */
  user: { id: Uuid; name: string }
}

// --- DELETE /api/session ----------------------------------------------------
// 204, no body. Sets the cookie v29_token expired (same path and attributes as when it was set).
// Needs no sign-in, like POST /api/session. The cookie is shared: signing out of the administration
// signs the app out in the same browser too.

// --- GET /api/admin/me -------------------------------------------------------
// The administration's sign-in check. Everything below /api/admin/ needs the role admin or superadmin:
// 401 without a cookie or with an unknown or revoked one, 403 for the role user (checked centrally,
// the endpoints do not repeat it). Used by the administration only.

export type UserRole = 'user' | 'admin' | 'superadmin'

export interface AdminMeResponse {
  user: { id: Uuid; name: string; role: UserRole }
}

// --- GET /api/admin/activity -------------------------------------------------
// Who recorded what and when, newest first. Query (all optional): from=YYYY-MM-DD, to=YYYY-MM-DD (days in German time,
// both inclusive), user=<uuid> or several, separated by commas (an entry matches if it is from any of them),
// tags=parts separated by commas: a number (104) or a range (100-120) as for --range of the console commands, which also matches the
// beams of the stems, or a beam tag (104-A, also 104a or 104A, any case, leading zeros allowed), which matches only that beam,
// e.g. 100-120,104-A, before=<next_cursor of the previous page>. A malformed filter is a 400.
// An entry is a run of events from one person whose arrival times are less than a second apart (one sync, or
// one console command), never split across pages. With a tag filter an entry keeps only the matching items;
// event_count counts those. entries_unfiltered counts without from, to, user and tags. Fixture: fixtures/activity-response.json.

export interface ActivityResponse {
  /** Newest first, at most 50. */
  entries: ActivityEntry[]
  /** For "Ältere laden"; null = no more. */
  next_cursor: string | null
  /** All entries without any filter, formed like those of `totals.entries`; the same on every page. For "12 von 248 Einträgen". */
  entries_unfiltered: number
  /** Over the whole filter, not just this page. */
  totals: { entries: number; events: number; photos: number; users: number }
  /** Everyone with events, regardless of the filter: for the person menu. */
  users: { id: Uuid; name: string }[]
}

export interface ActivityEntry {
  /** The entry's first event. */
  id: Uuid
  /** Arrival of the first event at the server. */
  received_at: Timestamp
  user: { id: Uuid; name: string }
  /** Earliest and latest device time of the entry (a console command writes its own instant). */
  recorded_from: Timestamp
  recorded_to: Timestamp
  event_count: number
  /** One per stem or beam, a stem before its beams, otherwise in the order the events came in. */
  items: ActivityItem[]
}

export interface ActivityItem {
  timber_item_id: Uuid
  /** Current tag: "104", "104-C"; "ohne Kennung" if it has none. */
  label: string
  /** One per event, in the order they were recorded. */
  changes: ActivityChange[]
}

export interface ActivityChange {
  kind: 'created' | 'value' | 'photo' | 'photo_removed' | 'tag' | 'voided' | 'restored'
  /**
   * Column "Merkmal", ready to show. By case: created → "Stamm" or "Balken" (a beam has a stem above it); tag → "Kennung";
   * value or photo → the attribute's name (inactive ones too); voided or restored → the name of what it affects, in the same words
   * ("Stamm"/"Balken" for the whole item, "Kennung", an attribute's name), "Ereignis" if that event cannot be found.
   * photo_removed (a voided event that refers to the recording of one photo, e.g. after app:photo:move) → the name of the photo attribute.
   */
  name: string
  /**
   * Column "Wert", ready to show, without a count. By case: created → "angelegt"; tag → the number, "104"; value → the value as in the export;
   * photo → "hinzugefügt"; photo_removed → "entfernt"; voided → "storniert"; restored → "wiederhergestellt".
   */
  value: string
  recorded_at: Timestamp
}

// --- GET /api/admin/timber-items/{id}/key-figures ----------------------------
// Round wood, sawn timber and yield of a stem or beam, calculated on the server with the same formulas as the export.
// Which figures: an unsawn stem → round_wood; a sawn stem (with beams or sawn whole) → round_wood, sawn_timber, yield;
// a beam → sawn_timber (its own volume). Status: 404 if the item does not exist or is voided. Fixture: fixtures/key-figures-response.json.

export interface KeyFiguresResponse {
  figures: KeyFigure[]
}

export interface KeyFigure {
  key: 'round_wood' | 'sawn_timber' | 'yield'
  /** "Rundholz", "Schnittholz", "Ausbeute" */
  label: string
  /** fm (round wood) or m³ (sawn timber; 1 fm = 1 m³), or the share 0–1 for the yield; null = not calculable. */
  value: number | null
  unit: 'fm' | 'm³' | '%'
  /** The small line under the value, e.g. "aus 40 × 39 cm und 4,10 m"; with value null it says what is missing. */
  source: string
  /** "π ÷ 4 × Durchmesser groß × Durchmesser klein × Länge" (attribute names as in the database) */
  formula: string
  /** "0,785 × 0,40 m × 0,39 m × 4,10 m"; null if value is null. */
  inserted: string | null
  /** Remark under the result, e.g. "Vorläufige Formel: Durchmesser mit Rinde, kein Abzug." */
  note: string | null
}

// --- GET /api/admin/dashboard ------------------------------------------------

// GET /api/admin/dashboard – roles admin and superadmin, otherwise 403
export interface DashboardResponse {
  /** Server time of the newest event (received_at) or photo upload (uploaded_at), whichever is later; null = neither */
  last_sync_at: string | null
  /** In display order; today only "sawing". Later work steps (sorting …) come as further sections – the administration renders sections generically, without knowing their keys */
  sections: DashboardSection[]
}

/** The type says how the administration renders a section; within a type it knows no key. */
export type DashboardSection =
  DashboardFiguresSection | DashboardDiameterSection | DashboardPileSection

export interface DashboardFiguresSection {
  type: 'figures'
  /** Stable, e.g. "sawing" */
  key: string
  /** "Kennzahlen: Sägen" */
  label: string
  figures: DashboardFigure[]
}

/** Processed stems in classes of 2 cm by the mean of both diameters ("stems_by_diameter"). Numbers raw, the administration formats and sorts. */
export interface DashboardDiameterSection {
  type: 'diameter_classes'
  key: string
  /** "Stämme nach Mittendurchmesser" */
  label: string
  /** The whole calculation, one term each ("Durchmesser" …); the texts carry the attribute names from the database */
  notes: { term: string; text: string }[]
  /** Ascending by from_cm, from the smallest to the largest class with a stem; empty classes in between with 0 */
  rows: DiameterClass[]
  /** Processed stems without any diameter: not in a class */
  without_diameter: number
}

/** One card per pile with at least one stem (inactive options too), after the other sections, in the order of the options. */
export interface DashboardPileSection {
  type: 'pile'
  /** "pile-" + option id */
  key: string
  /** "Polter 2601-010145 (Krummes F)"; without master data the option label */
  label: string
  /** The whole calculation, one term each; the texts carry the attribute names from the database */
  notes: { term: string; text: string }[]
  stems: number
  /** Raummeter of the pile, null = not entered */
  stacked_volume: number | null
  latitude: number | null
  longitude: number | null
  /** Stems: sawn (as in the section "sawing"), unsawable and not sawn, the rest */
  progress: { sawn: number; not_sawable: number; open: number }
  /** null values without a sawn stem; same definitions as the section "sawing" */
  yield: {
    ratio: number | null
    sawn_timber_m3: number | null
    waste_fm: number | null
    round_wood_fm: number | null
  }
  /** Labels of the two sizes, e.g. "Balken 14×14", "Balken 10×14" (large: shorter side of the cross-section ≥ 12 cm) */
  size_labels: { large: string; small: string }
  /** Monday of the ISO week (YYYY-MM-DD, Europe/Berlin), ascending, from the first week with a sawn beam to the current week (the last entry), empty weeks with 0; empty without a sawn beam */
  weeks: { week_start: string; large: number; small: number }[]
  /** Mean beams per week over the completed weeks (the current one does not count); null if none */
  average_per_week: number | null
}

export interface DiameterClass {
  /** A class holds two whole cm (the class diameter is rounded down): 32 and 33 cm are from_cm 32, to_cm 34, shown as "32–33 cm" */
  from_cm: number
  /** Not in the class (half-open interval from_cm ≤ d < to_cm): the next class starts here */
  to_cm: number
  /** Processed stems, the unsawable ones included */
  stems: number
  not_sawable: number
  /** Sawn timber ÷ round wood of the sawn stems, 0–1; null without a sawn stem */
  yield: number | null
  /** Large beams ÷ sawn stems, a stem sawn whole is one beam; null without a sawn stem. Large: shorter side of the cross-section ≥ 12 cm; without a readable cross-section a beam counts in neither */
  beams_per_stem_large: number | null
  /** Small beams (shorter side < 12 cm) ÷ sawn stems, as beams_per_stem_large */
  beams_per_stem_small: number | null
}

export interface DashboardFigure {
  key: string
  label: string
  value: number | null
  /** null = count */
  unit: 'fm' | 'm³' | '%' | null
  /** Content of the info button, same meaning as in KeyFigure */
  formula: string
  inserted: string | null
  note: string | null
}

// --- /api/admin/users --------------------------------------------------------
// User management in the administration (roles admin and superadmin, otherwise 403). Users are never deleted, only blocked (their events refer to them).
// Rules, checked by the server (403 if broken, the administration hides what is not allowed; the flags below say what the acting user may do):
// admin and superadmin create, rename, block and unblock users with the role "user" and issue them a new invite code; only the superadmin does the
// same for users with the role "admin" and gives or takes the role "admin"; nobody changes, blocks or creates a superadmin; nobody blocks themselves.
// The "invite" is the personal code (the app has no link that signs in, the code is typed; the app explains the installation itself).

/** GET /api/admin/users: everybody, in the order of creation, blocked users too. */
export interface AdminUsersResponse {
  users: AdminUser[]
  /** The roles the acting user may give to a new user (admin: user; superadmin: user, admin). */
  creatable_roles: Exclude<UserRole, 'superadmin'>[]
}

export interface AdminUser {
  id: Uuid
  name: string
  role: UserRole
  created_at: Timestamp
  /** Blocked since then; the invite code does not work and the user is out at once. Null = active. */
  revoked_at: Timestamp | null
  /** Latest time events of the user reached the server (a sync); null if none yet. */
  last_active_at: Timestamp | null
  /** Rename, block, unblock or issue a new invite code. */
  can_manage: boolean
  /** Block (not oneself); unblocking needs can_manage. */
  can_block: boolean
  /** Give or take the role "admin" (superadmin only, never for a superadmin). */
  can_set_role: boolean
}

/**
 * POST /api/admin/users (answers 201 with AdminInviteResponse; name and role are required, role is not "superadmin").
 * PATCH /api/admin/users/{id} (answers 200 with AdminUserResponse; fields left out stay as they are; 404 for an unknown id).
 * Status 422 as AttributeErrorsResponse: field "name", "role" or "blocked".
 */
export interface AdminUserInput {
  name: string
  role: Exclude<UserRole, 'superadmin'>
  /** true blocks, false unblocks (the same code works again). */
  blocked: boolean
}

export interface AdminUserResponse {
  user: AdminUser
}

/**
 * The invite code is a password: only its hash is stored, so it is shown exactly once, in the answer to the call that makes it. Nothing shows it
 * again (the list and the single user carry none); whoever loses it gets a new one.
 * POST /api/admin/users answers 201 with this (see AdminUserInput), and so does
 * POST /api/admin/users/{id}/invite (no body): a new code; the old one stops working at once (whoever uses it has to sign in again).
 * 409 for a blocked user.
 */
export interface AdminInviteResponse extends AdminUserResponse {
  invite: {
    /** "K7QM-4XHT-9RDP" */
    code: string
  }
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

/** A stem sawn as a whole (no beams) is a beam too; a stem with beams is only a stem. */
export type ItemKind = 'stem' | 'beam'

export interface Attribute {
  id: Uuid
  /** Stable key from the database, null for attributes without a key. */
  key: string | null
  name: string
  description: string
  type: AttributeType
  /** Only set for type "number", otherwise null. */
  unit: string | null
  is_series: boolean
  is_inheritable: boolean
  /** Kinds of timber item the attribute is recorded on. Never empty. Only the app applies it; the server accepts any event. */
  applies_to: ItemKind[]
  /** Ids of yes/no attributes: while one of them is "ja" on the item, this attribute is not offered. */
  hidden_when: string[]
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

// --- /api/admin/attributes --------------------------------------------------
// Maintenance of attributes in the administration (roles admin and superadmin, otherwise 403). The app gets changes through the snapshot as before.
// An attribute with a key is a system attribute: created and changed by migrations; PATCH accepts only name and description (any other field that differs answers 422), and its order can change.
// Attributes are never deleted. Changes leave no events and do not appear in the activity list.

/** GET /api/admin/attributes: every attribute in order, inactive ones and inactive options too. */
export interface AdminAttributesResponse {
  attributes: AdminAttribute[]
}

export interface AdminAttribute extends Attribute {
  /** Has a key: only name, description and order can be changed in the administration. */
  is_system: boolean
  /** At least one value was recorded, on a voided item too: type, is_series and is_inheritable can then no longer change. */
  has_values: boolean
}

/**
 * POST /api/admin/attributes (answers 201 with the AdminAttribute, appended to the order; name and type are required, the rest defaults to
 * description '', unit null, is_series false, is_inheritable false, applies_to both kinds, hidden_when [], active true) and
 * PATCH /api/admin/attributes/{id} (answers 200 with the AdminAttribute; fields left out stay as they are; 404 for an unknown id).
 * Unknown fields (id, key, sort_order, is_system, has_values) are ignored, so a fetched attribute can be sent back changed.
 */
export interface AdminAttributeInput {
  name: string
  description: string
  /** Not 'photo'. Does not change (422) once values are recorded or while another attribute names this one in hidden_when. */
  type: Exclude<AttributeType, 'photo'>
  /** Only for type 'number'. */
  unit: string | null
  /** Only for number, text, date and month. */
  is_series: boolean
  is_inheritable: boolean
  /** At least one. */
  applies_to: ItemKind[]
  /** Ids of yes/no attributes other than this one. Not changeable on a system attribute. */
  hidden_when: string[]
  active: boolean
  /**
   * Type 'choice': the complete list in order, at least one active. With id = existing option, without = new.
   * An existing option must not be left out (options are never deleted, only set to active: false).
   */
  options: { id?: Uuid; label: string; active: boolean }[]
}

/** PUT /api/admin/attributes/order: every attribute id once (system attributes too) in the new order; answers 200 with AdminAttributesResponse. */
export interface AdminAttributeOrderRequest {
  ids: Uuid[]
}

/**
 * Status 422 when a rule is broken: German messages ready for display, all violations at once.
 * field = the field of AdminAttributeInput ("name", "type", "unit", "applies_to", "hidden_when", "is_series", "is_inheritable", "options"),
 * for one option "options.<index>.label" or "options.<index>.id"; "ids" for the order. Locked by has_values: type, is_series, is_inheritable.
 */
export interface AttributeErrorsResponse {
  errors: { field: string; message: string }[]
}

// --- /api/admin/piles --------------------------------------------------------
// Master data of the piles ("Polter") from the handover record of the forestry office (roles admin and superadmin, otherwise 403).
// A pile is an option of the attribute with the key 'source'; the value recorded on a timber item stays the option id, so the app, the sync and
// the snapshot do not change. The server derives the label of the option on every save: "number (location)", or only the number, and overwrites
// the option with it. Nothing is deleted and the administration does not deactivate piles (the activity of the option stays as it is). No events,
// not in the activity list.

/** GET /api/admin/piles: every option of the attribute with key 'source', in order, inactive options too. An option without master data has null fields. */
export interface AdminPilesResponse {
  piles: AdminPile[]
}

export interface AdminPile {
  /** The option id. */
  id: Uuid
  /** As stored on the option, the one the app shows. */
  label: string
  /** The forester's pile number, free text; null only for an option that has no master data yet. */
  number: string | null
  /** Storage place per forester. */
  location: string | null
  /** Decimal degrees. */
  latitude: number | null
  longitude: number | null
  /** Raummeter. */
  stacked_volume: number | null
}

/**
 * POST /api/admin/piles (answers 201 with the AdminPile; creates the option, appended at the end, and its master data; fields left out are null,
 * a missing number is 422) and PATCH /api/admin/piles/{id} (answers 200 with the AdminPile; fields left out stay as they are; 404 for an unknown id;
 * the master data of an option that had none is created with the first PATCH, which needs the number).
 * Status 422 as AttributeErrorsResponse, field = the field of AdminPileInput. Rules, all violations at once: the number is set (texts are trimmed,
 * empty = null, at most 32 and 200 characters), no other pile has the same number or the same label, latitude (-90 to 90) and longitude
 * (-180 to 180) come together or not at all, stacked_volume is above 0 with at most two decimals.
 */
export interface AdminPileInput {
  number: string
  location: string | null
  latitude: number | null
  longitude: number | null
  stacked_volume: number | null
}

export interface TimberItem {
  id: Uuid
  /** Set for beams: the timber item they were cut from. */
  parent_id: Uuid | null
  /** Latest tag ("123", beams "123-A"). Without leading zeros, not unique, null if none assigned yet. */
  tag_number: string | null
  /** Split into beams: the app records only notes on it; the server still accepts any event. */
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
  /**
   * Only for the value of a photo attribute whose file is uploaded: when the photo was taken (the EXIF time of a library photo, else the time
   * of the recording on the device). The snapshot adds it from the photo's row; the administration's gallery shows it, falling back to `recorded_at`.
   */
  taken_at?: Timestamp
}

/** boolean → true/false, choice → option id (never the label), number → number,
 *  text → string, date → CalendarDate, month → CalendarMonth, photo → photo id.
 *  A photo id can be recorded before its file is uploaded: GET /api/photos/{id} answers 404 until then. */
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
   * They leave the queue as well; the app drops the items whose created event is among them.
   */
  rejected: RejectedEvent[]
}

/**
 * tag_already_taken: another item that is not voided already holds the tag (on the server or earlier in the request).
 * - The item was created with that tag (its first tag_assigned in the request) – a duplicate capture.
 *   All events of that item and of its beams in the request are rejected.
 * - Any later tag_assigned (new plaque, corrected typo): only that event is rejected, the item keeps its previous tag.
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
  | (EventBase & { type: 'voided'; data: Record<string, never> })
  | (EventBase & {
      type: 'attribute_recorded'
      data: { attribute_id: Uuid; value: AttributeValue }
    })
// voided: the app sends it to remove a beam it has already synced (a stem cannot be removed here). The server sets
// reference_id to the created event of the beam. Unknown id or a stem: 400. A beam voided already is accepted, nothing changes.

// --- POST /api/photos --------------------------------------------------------
// multipart/form-data, one JPEG per request. Independent of POST /api/sync: before or after the event that
// records the photo id, and a failed upload never blocks the sync. Repeating an upload of the same id is harmless.
// Status: 201 stored, 200 id already known (nothing changed), 400 malformed, 401, 413 over 10 MB, 415 not a JPEG.
// The file is stored unchanged; compression happens on the device (4032 px long edge, JPEG quality 0.6 on Apple's encoder, 0.85 elsewhere).

/** Form fields; the JPEG itself is the file part "file". */
export interface PhotoUploadFields {
  /** Generated on the device (crypto.randomUUID()); the value recorded for the photo attribute. */
  id: Uuid
  /** The stem or beam the photo was taken for. It does not need to exist on the server yet. */
  timber_item_id: Uuid
  /** Device time of the shot. */
  taken_at: Timestamp
}

export interface PhotoUploadResponse {
  id: Uuid
}

// --- GET /api/photos/{id} ----------------------------------------------------
// The JPEG exactly as uploaded (image/jpeg), only for signed-in users. 404 while the upload has not arrived.

// --- POST /api/diagnostics ---------------------------------------------------
// The app records errors, failed requests and flow steps on the device and sends them by itself (no button, no
// attribute values, invite codes or photo contents). Symfony writes each entry as one line to its own log file.
// Status: 204 stored, 401 not signed in (the app keeps its entries until the next sign-in), 413 more than 100 entries
// or more than 256 KB, 400 malformed. The server truncates strings: message 1,000 characters, context strings 500.

export interface DiagnosticsRequest {
  user_agent: string
  /** At most 100 per request. */
  entries: DiagnosticEntry[]
}

export interface DiagnosticEntry {
  /** Generated on the device (crypto.randomUUID()). */
  id: Uuid
  /** Device time of the first occurrence. */
  at: Timestamp
  level: 'error' | 'warning' | 'info'
  /** Short machine-readable string, e.g. "photo_upload", "request_failed", "sync", "update". */
  kind: string
  message: string
  /** How often the same kind and message occurred while the entry was still unsent (at least 1). */
  count: number
  /** Flat scalar values only; nested values make the request malformed (400). */
  context: Record<string, string | number | boolean | null>
}

// --- GET /api/ping -----------------------------------------------------------
// No login needed.

export interface PingResponse {
  ok: true
}
