<script setup lang="ts">
import { EllipsisIcon, ShareIcon, SquarePlusIcon } from '@lucide/vue'
</script>

<!-- List items only: callers wrap them in their own <ol> and add the surrounding steps. -->
<template>
  <li>
    Auf <EllipsisIcon :size="20" class="inline align-text-bottom" aria-hidden="true" /> neben der
    Adressleiste tippen, dann auf
    <span class="whitespace-nowrap"
      ><ShareIcon :size="20" class="mr-1 inline align-text-bottom" aria-hidden="true" />
      <b>„Teilen“</b></span
    >
    (bei älteren iPhones direkt unten auf
    <span class="whitespace-nowrap"
      ><ShareIcon :size="20" class="mr-1 inline align-text-bottom" aria-hidden="true" />
      <b>„Teilen“</b></span
    >).
  </li>
  <li>
    Auf
    <span class="whitespace-nowrap"
      ><SquarePlusIcon :size="20" class="mr-1 inline align-text-bottom" aria-hidden="true" />
      <b>„Zum Home-Bildschirm“</b></span
    >
    tippen, falls nicht sichtbar, vorher auf <b>„Mehr anzeigen“</b>.
  </li>
  <li><b>„Als Web-App öffnen“</b> eingeschaltet lassen, dann auf <b>„Hinzufügen“</b> tippen.</li>
  <li>Die App vom Home-Bildschirm aus öffnen.</li>
</template>
