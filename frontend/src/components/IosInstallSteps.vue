<script setup lang="ts">
import { ShareIcon } from '@lucide/vue'
</script>

<!-- List items only: callers wrap them in their own <ol> and may add steps. -->
<template>
  <li>
    Unten auf <ShareIcon :size="20" class="inline align-text-bottom" aria-hidden="true" />
    <b>Teilen</b> tippen, dann <b>„Zum Home-Bildschirm“</b>.
  </li>
  <li>Die App vom Home-Bildschirm aus öffnen.</li>
</template>
