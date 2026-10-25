<script setup lang="ts">
import { CircleCheckIcon, TriangleAlertIcon } from '@lucide/vue'
import FormattedTag from '@/components/FormattedTag.vue'
import { useToast } from '@/composables/useToast'

const { current } = useToast()
</script>

<template>
  <!-- Not clickable (pointer-events-none): taps go through to the content below. -->
  <Teleport to="body">
    <div
      v-if="current"
      class="pointer-events-none fixed top-1/2 left-1/2 z-60 flex w-[calc(100%-32px)] max-w-[398px] -translate-1/2 items-center gap-3 rounded-lg border-2 border-ink bg-paper px-4 py-3.5 text-xl leading-[1.3] font-semibold text-ink shadow-lg select-none"
      role="status"
    >
      <TriangleAlertIcon
        v-if="current.kind === 'warning'"
        class="shrink-0"
        :size="28"
        aria-hidden="true"
      />
      <CircleCheckIcon v-else class="shrink-0" :size="28" aria-hidden="true" />
      <span class="min-w-0 flex-1"
        >{{ current.before }}
        <FormattedTag v-if="current.tagNumber !== undefined" :tag-number="current.tagNumber" />
        {{ current.after
        }}<template v-if="current.more">
          · {{ current.more.before }}
          <FormattedTag
            v-if="current.more.tagNumber !== undefined"
            :tag-number="current.more.tagNumber"
          />
          {{ current.more.after }}</template
        ></span
      >
    </div>
  </Teleport>
</template>
