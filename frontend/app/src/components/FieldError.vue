<script setup lang="ts">
// The error text of a field, see `useFieldError`. Renders nothing without a message.
defineProps<{ id: string; message?: string | null }>()
</script>

<template>
  <p v-if="message" :id="id" class="text-sm font-semibold text-alert" role="alert">
    {{ message }}
  </p>
</template>
