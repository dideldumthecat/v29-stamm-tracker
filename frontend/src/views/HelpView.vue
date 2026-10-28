<script setup lang="ts">
import { useRouter } from 'vue-router'
import { XIcon } from '@lucide/vue'
import AndroidInstallSteps from '@/components/AndroidInstallSteps.vue'
import IosInstallSteps from '@/components/IosInstallSteps.vue'
import { useStoragePersistence } from '@/composables/useStoragePersistence'
import { formatShortDateTime } from '@/utils/date'

const router = useRouter()
const { isPersisted } = useStoragePersistence()
const appVersion = [__APP_REVISION__, formatShortDateTime(__APP_BUILD_TIME__)]
  .filter(Boolean)
  .join(' · ')
</script>

<template>
  <div class="flex min-h-0 flex-col overflow-y-auto">
    <header class="flex h-header shrink-0 items-center gap-3 border-b-2 border-ink px-gutter">
      <button
        type="button"
        class="flex size-11 items-center justify-center rounded-lg border-2 border-current"
        aria-label="Schließen"
        @click="router.push({ name: 'start' })"
      >
        <XIcon :size="22" aria-hidden="true" />
      </button>
      <h1 class="flex-1 text-center text-xl font-bold">Hilfe</h1>
      <span class="w-11 shrink-0"></span>
    </header>

    <div class="flex flex-col gap-8 py-6 px-gutter text-lg leading-[1.4]">
      <section class="flex flex-col gap-3">
        <h2 class="text-[26px] font-bold text-balance">Synchronisieren</h2>
        <p>Erfassen geht auch ohne Netz. Alles bleibt auf dem Handy, bis du es hochlädst.</p>
        <p>
          Die App holt den aktuellen Stand automatisch, sobald du Netz hast. Wann zuletzt, steht auf
          der Startseite unter „Stand der Daten“.
        </p>
        <p>
          Deine eigenen Einträge lädst du mit dem Sync-Button hoch. Die Zahl am Button zeigt, wie
          viele noch fehlen.
        </p>
        <p>Lade sie hoch, sobald du Empfang hast, spätestens nach dem Einsatz.</p>
        <p class="rounded-lg border-2 border-ink p-3" role="note">
          <b>Achtung:</b> Die App nicht löschen und keine Website-Daten entfernen, solange am
          Sync-Button eine Zahl steht. Sonst sind diese Einträge verloren.
        </p>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-[26px] font-bold text-balance">App auf einem neuen Handy installieren</h2>
        <details class="rounded-lg border-2 border-ink">
          <summary class="min-h-14 cursor-pointer px-3 py-4 font-bold">iPhone (Safari)</summary>
          <ol class="flex list-decimal flex-col gap-3 pr-3 pb-4 pl-9">
            <li>Adresse aus der Einladung in Safari öffnen.</li>
            <IosInstallSteps />
            <li>Mit dem Einladungscode anmelden.</li>
          </ol>
        </details>
        <details class="rounded-lg border-2 border-ink">
          <summary class="min-h-14 cursor-pointer px-3 py-4 font-bold">Android (Chrome)</summary>
          <ol class="flex list-decimal flex-col gap-3 pr-3 pb-4 pl-9">
            <li>Adresse aus der Einladung in Chrome öffnen.</li>
            <AndroidInstallSteps />
            <li>Mit dem Einladungscode anmelden.</li>
          </ol>
        </details>
        <p>Danach nur noch über das Symbol öffnen: Browser und App haben getrennte Daten.</p>
      </section>
    </div>

    <div class="mt-auto flex flex-col gap-1 py-4 px-gutter text-center text-[13px] text-mute">
      <p>
        Speicher geschützt:
        {{ isPersisted === null ? 'unbekannt' : isPersisted ? 'ja' : 'nein' }}
      </p>
      <p>App-Version: {{ appVersion }}</p>
    </div>
  </div>
</template>
