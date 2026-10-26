<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ChevronLeftIcon, EllipsisVerticalIcon } from '@lucide/vue'
import IosInstallSteps from '@/components/IosInstallSteps.vue'
import { useStoragePersistence } from '@/composables/useStoragePersistence'

const router = useRouter()
const { isPersisted } = useStoragePersistence()
</script>

<template>
  <div class="flex min-h-0 flex-col overflow-y-auto">
    <header class="flex h-header shrink-0 items-center gap-3 border-b-2 border-ink px-gutter">
      <button
        type="button"
        class="flex size-11 items-center justify-center rounded-lg border-2 border-current"
        aria-label="Zurück"
        @click="router.push({ name: 'start' })"
      >
        <ChevronLeftIcon :size="22" aria-hidden="true" />
      </button>
      <h1 class="flex-1 text-center text-xl font-bold">Hilfe</h1>
      <span class="w-11 shrink-0"></span>
    </header>

    <div class="flex flex-col gap-8 py-6 px-gutter text-lg leading-[1.4]">
      <section class="flex flex-col gap-3">
        <h2 class="text-[26px] font-bold text-balance">App installieren</h2>
        <h3 class="font-bold">iPhone (Safari)</h3>
        <ol class="flex list-decimal flex-col gap-3 pl-6">
          <IosInstallSteps />
        </ol>
        <p>
          Danach nur noch über das Symbol öffnen: Safari und die App auf dem Home-Bildschirm haben
          getrennte Daten.
        </p>
        <h3 class="font-bold">Android (Chrome)</h3>
        <p>
          Oben rechts auf das Menü
          <EllipsisVerticalIcon :size="20" class="inline align-text-bottom" aria-hidden="true" />
          tippen, dann <b>„App installieren“</b> bzw. <b>„Zum Startbildschirm hinzufügen“</b>.
        </p>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-[26px] font-bold text-balance">Synchronisieren</h2>
        <ul class="flex list-disc flex-col gap-3 pl-6">
          <li>Erfassen geht auch ohne Netz. Alles bleibt auf dem Handy, bis du synchronisierst.</li>
          <li>Die Zahl am Sync-Button zeigt, wie viele Einträge noch nicht hochgeladen sind.</li>
          <li>
            <b>Vor</b> dem Einsatz synchronisieren: Dann hast du den aktuellen Stand aller.
            <b>Danach</b> synchronisieren: Dann sind deine Einträge hochgeladen.
          </li>
          <li>Wann zuletzt synchronisiert wurde, steht auf der Startseite unter „Letzter Sync“.</li>
        </ul>
        <p class="rounded-lg border-2 border-ink p-3" role="note">
          <b>Achtung:</b> Die App nicht löschen und keine Website-Daten entfernen, solange am
          Sync-Button eine Zahl steht. Sonst sind diese Einträge verloren.
        </p>
      </section>
    </div>

    <p class="mt-auto py-4 px-gutter text-center text-[13px] text-mute">
      Speicher geschützt:
      {{ isPersisted === null ? 'unbekannt' : isPersisted ? 'ja' : 'nein' }}
    </p>
  </div>
</template>
