<script setup lang="ts">
import { EllipsisVerticalIcon } from '@lucide/vue'
</script>

<!-- List items only: callers wrap them in their own <ol> and may add steps. -->
<template>
  <li>
    Oben rechts auf das Menü
    <EllipsisVerticalIcon :size="20" class="inline align-text-bottom" aria-hidden="true" />
    tippen, dann <b>„App installieren“</b> bzw. <b>„Zum Startbildschirm hinzufügen“</b>.
  </li>
  <li>Die App vom Startbildschirm aus öffnen.</li>
</template>
