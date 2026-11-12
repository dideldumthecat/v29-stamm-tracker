<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  TreesIcon,
  XIcon,
} from '@lucide/vue'
import type { Snapshot } from '@v29/shared/contract'
import FormattedTag from '@v29/shared/FormattedTag.vue'
import SawBladeIcon from '@v29/shared/SawBladeIcon.vue'

import { ApiError, request } from '@/api/client'
import StatusCard from '@/components/StatusCard.vue'
import {
  applyFilters,
  buildColumns,
  buildRows,
  filtersFor,
  headingWords,
  readQuery,
  sortBy,
  sortRows,
  stemsText,
  writeQuery,
} from '@/stemlist'
import { useScrollEdges } from '@/scrollEdges'
import { useSizeVariable } from '@/sizeVariable'
import { useTagsField } from '@/tagsField'

const route = useRoute()
const router = useRouter()

const status = ref<'loading' | 'ready' | 'error'>('loading')
const failure = ref(0)
const snapshot = ref<Snapshot | null>(null)

async function load() {
  status.value = 'loading'
  try {
    snapshot.value = await request<Snapshot>('GET', 'snapshot')
    status.value = 'ready'
  } catch (error) {
    failure.value = error instanceof ApiError ? error.status : 0
    status.value = 'error'
  }
}
void load()

// Everything is loaded once; sorting and filtering happen here. The URL is the only source of both.
const columns = computed(() => buildColumns(snapshot.value?.attributes ?? []))
// The cells of all rows are worked out here, once per snapshot: filtering, sorting and drawing only use them
const allRows = computed(() => (snapshot.value ? buildRows(snapshot.value, columns.value) : []))
const query = computed(() => readQuery(route.query, columns.value))
// null: the "Kennung" in the URL cannot be read
const filters = computed(() => filtersFor(query.value))
const rows = computed(() => {
  if (!filters.value) return []
  const column = columns.value.find((candidate) => candidate.id === query.value.sort)!
  return sortRows(applyFilters(allRows.value, filters.value), column, query.value.dir)
})
const hasFilter = computed(() => query.value.tags !== '')
const showTable = computed(() => status.value === 'ready' && rows.value.length > 0)

function sortOn(columnId: string) {
  void router.push({ query: writeQuery(sortBy(query.value, columnId)) })
}
function setTags(tags: string, replace: boolean) {
  // Whatever else is in the URL (sort, direction) stays as it is
  const next = { ...route.query }
  if (tags) next.tags = tags
  else delete next.tags
  void (replace ? router.replace({ query: next }) : router.push({ query: next }))
}

// The page scrolls sideways when the table is wider than the window; the arrows in the bar do it by about 60 % of what is visible,
// smoothly unless the system asks for less motion.
const table = useTemplateRef<HTMLElement>('table')
const { canScrollLeft, canScrollRight } = useScrollEdges(table)
function scrollTable(direction: -1 | 1) {
  // The optional call is for jsdom, which has no matchMedia
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  window.scrollBy({
    left: direction * document.documentElement.clientWidth * 0.6,
    behavior: reduced ? 'auto' : 'smooth',
  })
}

// The bar with the number of stems, the table head and the first column stay in view. Their sizes go into the scroll padding of the page
// (main.css), so that a focused link or button does not end up behind them.
const bar = useTemplateRef<HTMLElement>('bar')
const head = useTemplateRef<HTMLElement>('head')
const stemHead = computed(() => head.value?.querySelector('th') ?? null)
useSizeVariable(bar, '--sticky-bar-height', 'height')
useSizeVariable(head, '--table-head-height', 'height')
useSizeVariable(stemHead, '--stem-column-width', 'width')

const tagsField = useTemplateRef<HTMLInputElement>('tagsField')
const { tagsInput, onTagsInput, applyTagsNow, clearTags, resetTagsInput } = useTagsField({
  current: () => query.value.tags,
  apply: setTags,
  field: tagsField,
})
function resetFilter() {
  resetTagsInput()
  void router.push({ query: writeQuery({ ...query.value, tags: '' }) })
}
function resetFromBar() {
  resetFilter()
  tagsField.value?.focus()
}
</script>

<template>
  <!-- The page scrolls sideways when the table is wider than the window (App.vue makes the page as wide as its content for this marker).
       Everything but the table is as wide as the window (100cqw, see main.css) and sticks to its left edge, so it stays put meanwhile. -->
  <main data-wide class="py-8">
    <div class="sticky left-0 w-[100cqw]">
      <div class="page-column">
        <h1 class="text-3xl font-bold">Stämme</h1>
        <p class="mt-2 text-mute">Eine Spalte je Merkmal, Reihenfolge wie in der App.</p>

        <form class="mt-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3" @submit.prevent>
          <div class="flex max-w-sm min-w-48 flex-1 flex-col text-sm text-mute">
            <label for="stems-tags">Kennung</label>
            <span class="relative flex">
              <input
                id="stems-tags"
                ref="tagsField"
                v-model="tagsInput"
                type="text"
                inputmode="text"
                autocomplete="off"
                placeholder="z. B. 104 oder 100-120"
                class="mt-1 h-11 w-full rounded-lg border-2 px-3 pr-11 text-base text-ink placeholder:text-dim focus:bg-paper"
                :class="hasFilter ? 'border-ink bg-paper' : 'border-dim bg-transparent'"
                @input="onTagsInput"
                @keydown.enter="applyTagsNow"
                @change="applyTagsNow"
              />
              <!-- mousedown.prevent keeps the focus in the field, so leaving it does not apply the half-typed text before the click clears it -->
              <button
                v-if="tagsInput"
                type="button"
                class="absolute top-1 right-0 flex size-11 items-center justify-center rounded-lg text-ink active:bg-ink active:text-paper"
                aria-label="Kennung leeren"
                @mousedown.prevent
                @click="clearTags"
              >
                <XIcon :size="18" aria-hidden="true" />
              </button>
            </span>
          </div>
          <!-- A group, so that the filters of the other columns can join it -->
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="flex h-11 items-center gap-2 rounded-lg px-2 text-base whitespace-nowrap text-ink underline enabled:active:bg-ink enabled:active:text-paper disabled:text-dim disabled:no-underline"
              :disabled="!hasFilter"
              @click="resetFromBar"
            >
              <XIcon :size="18" aria-hidden="true" />
              Filter zurücksetzen
            </button>
          </div>
        </form>

        <div v-if="status === 'error'" class="mt-6" role="alert">
          <p class="font-bold">
            {{
              failure === 0
                ? 'Keine Verbindung zum Server.'
                : 'Die Stämme konnten nicht geladen werden.'
            }}
          </p>
          <button
            type="button"
            class="mt-2 h-11 rounded-lg border-2 border-ink px-4 font-bold"
            @click="load"
          >
            Erneut versuchen
          </button>
        </div>

        <StatusCard
          v-else-if="status === 'loading'"
          title="Moment"
          text-class="max-w-[32ch]"
          role="status"
        >
          <template #icon>
            <SawBladeIcon
              :size="96"
              :stroke-width="1.5"
              spinning
              class="text-ink"
              aria-hidden="true"
            />
          </template>
          <template #text>Stämme werden zurechtgesägt</template>
        </StatusCard>

        <StatusCard
          v-else-if="!rows.length"
          title="Waldesruh"
          text-class="md:whitespace-nowrap"
          role="status"
        >
          <template #icon>
            <TreesIcon :size="96" :stroke-width="1.5" class="text-ink" aria-hidden="true" />
          </template>
          <template #text>
            Keine Ergebnisse weit und breit gefunden.
          </template>
          <button
            v-if="hasFilter"
            type="button"
            class="mt-2 h-11 rounded-lg border-2 border-ink px-4 font-bold"
            @click="resetFilter"
          >
            Filter zurücksetzen
          </button>
        </StatusCard>
      </div>
    </div>

    <template v-if="showTable">
      <!-- Sticky below the header (from lg on, below it the header scrolls away) and above the table and its fixed column (z-20), below the header (z-50).
           Its padding (8 px) is taken from the gaps around it, so that the page looks as before at the top. min-h-15 = 44 px + padding,
           so that the row does not grow when the arrows appear. -->
      <div
        ref="bar"
        class="sticky top-0 left-0 z-20 mt-4 w-[100cqw] bg-desk lg:top-[var(--header-height,0px)]"
      >
        <div class="page-column flex min-h-15 items-center justify-between gap-4 py-2">
          <p class="text-lg font-bold">{{ stemsText(rows.length, allRows.length, hasFilter) }}</p>
          <!-- Only for a table that does not fit; an arrow is disabled where there is nothing more to see -->
          <div v-if="canScrollLeft || canScrollRight" class="flex gap-2">
            <button
              type="button"
              class="flex size-11 items-center justify-center rounded-lg border-2 border-ink bg-paper disabled:border-line disabled:text-dim"
              aria-label="Tabelle nach links scrollen"
              :disabled="!canScrollLeft"
              @click="scrollTable(-1)"
            >
              <ChevronLeftIcon :size="22" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="flex size-11 items-center justify-center rounded-lg border-2 border-ink bg-paper disabled:border-line disabled:text-dim"
              aria-label="Tabelle nach rechts scrollen"
              :disabled="!canScrollRight"
              @click="scrollTable(1)"
            >
              <ChevronRightIcon :size="22" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <!-- The card around the table is as wide as its content, but at least as wide as the content of the page column, and centered in the window
           (auto margins). Wider than the window, it starts at the left edge, the page scrolls sideways and it ends flush with the right edge.
           The padding of 8 px keeps the square corners of the rows inside the round ones of the card; the last row has no line below it. No column shrinks below its content.
           Head and first column are sticky, the head below the bar (--sticky-top, main.css). -->
      <div
        class="mx-auto mt-2 w-max min-w-[calc(min(100cqw,1280px)-2*var(--page-gutter))] card p-2"
      >
        <table
          ref="table"
          class="w-max min-w-full border-separate border-spacing-0 text-base whitespace-nowrap tabular-nums"
        >
          <thead ref="head">
            <!-- The buttons lie in the sticky head (the first one also in the sticky column). The scroll padding of the page counts that as covered
               and would scroll to uncover them; a negative scroll margin takes them out of that zone. The same goes for the links in the first column. -->
            <tr>
              <th
                v-for="(column, index) in columns"
                :key="column.id"
                scope="col"
                class="sticky top-(--sticky-top) z-10 w-px min-w-20 border-b-2 border-ink bg-paper px-3 pt-3 pb-2 align-bottom text-caption leading-5 whitespace-normal"
                :class="[
                  column.align === 'right' ? 'text-right' : 'text-left',
                  column.id === query.sort ? 'font-bold text-ink' : 'font-semibold text-mute',
                  index === 0 && 'left-0 z-15 border-r border-r-soft pl-4',
                  index === columns.length - 1 && 'pr-4',
                  column.kind === 'changed' && 'border-l-2 border-l-soft',
                ]"
                :aria-sort="
                  column.id === query.sort
                    ? query.dir === 'desc'
                      ? 'descending'
                      : 'ascending'
                    : undefined
                "
              >
                <button
                  type="button"
                  class="scroll-mt-[calc(var(--table-head-height,0px)*-1)] hover:underline"
                  :class="[
                    column.align === 'right' ? 'text-right' : 'text-left',
                    index === 0 && 'scroll-ml-[calc(var(--stem-column-width,0px)*-1)]',
                  ]"
                  @click="sortOn(column.id)"
                >
                  <!-- Short words are never broken, long ones are hyphenated. The arrow sits inside the last word, so that it cannot wrap on its own; the negative margin keeps it from making the line higher. -->
                  <template v-for="(word, position) in headingWords(column.label)" :key="position">
                    <template v-if="position > 0">{{ ' ' }}</template>
                    <span
                      :class="word.hyphenate ? 'hyphens-auto' : 'hyphens-none whitespace-nowrap'"
                      >{{ word.text
                      }}<component
                        :is="query.dir === 'desc' ? ArrowDownIcon : ArrowUpIcon"
                        v-if="
                          column.id === query.sort &&
                          position === headingWords(column.label).length - 1
                        "
                        :size="16"
                        :stroke-width="2.5"
                        class="-my-1 ml-1 inline-block align-middle text-ink"
                        aria-hidden="true"
                    /></span>
                  </template>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <!-- Every row is as high as two text lines plus padding (2 x 24 + 2 x 12 px + 1 px border), whatever its cells hold: nothing shows more than two lines -->
            <tr v-for="row in rows" :key="row.item.id" class="group h-[73px] hover:bg-well">
              <th
                scope="row"
                class="sticky left-0 z-5 border-r border-b border-r-soft border-b-soft bg-paper py-3 pr-3 pl-4 text-left align-top group-last:border-b-0 group-hover:bg-well"
              >
                <RouterLink
                  v-if="row.item.tag_number"
                  :to="{ name: 'timber-item', params: { tag: row.item.tag_number } }"
                  class="scroll-ml-[calc(var(--stem-column-width,0px)*-1)] text-base font-extrabold tracking-[.05em] underline"
                  ><FormattedTag :tag-number="row.item.tag_number"
                /></RouterLink>
                <span v-else class="font-normal text-mute">ohne Kennung</span>
              </th>
              <td
                v-for="column in columns.slice(1)"
                :key="column.id"
                class="min-w-20 border-b border-soft px-3 py-3 align-top group-last:border-b-0"
                :class="[
                  column.align === 'right' && 'text-right',
                  column.kind === 'changed' && 'border-l-2 border-l-soft',
                  column.kind === 'changed' && 'pr-4',
                ]"
              >
                <span v-if="row.cells[column.id].text === null" class="text-mute">–</span>
                <!-- As wide as the text, up to 200 px (w-max): short values keep the column narrow, long ones wrap at word boundaries
                     and end after two lines with "…" (the full text is the tooltip); "(+n)" stays outside the clipped text. -->
                <div
                  v-else-if="column.wraps"
                  class="flex w-max max-w-[200px] items-start gap-1 whitespace-normal"
                >
                  <div class="line-clamp-2 min-w-0" :title="row.cells[column.id].text!">
                    {{ row.cells[column.id].text }}
                  </div>
                  <span v-if="row.cells[column.id].more" class="shrink-0 text-mute"
                    >(+{{ row.cells[column.id].more }})</span
                  >
                </div>
                <template v-else-if="column.kind === 'changed'">
                  {{ row.cells[column.id].text }}
                  <div v-if="row.cells[column.id].by" class="text-caption text-mute">
                    {{ row.cells[column.id].by }}
                  </div>
                </template>
                <template v-else>{{ row.cells[column.id].text }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </main>
</template>
