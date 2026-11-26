<script setup lang="ts">
withDefaults(defineProps<{ size?: number; strokeWidth?: number; spinning?: boolean }>(), {
  size: 24,
  strokeWidth: 1.5,
  spinning: false,
})
</script>

<!-- Same attributes as the Lucide icons, so it sits next to them; color comes from the surrounding text.
     14 slanted teeth between radius 8.2 and 10.5 around (12, 12), and the arbor hole (radius 2.5) in the middle.
     The rotation turns the group inside the SVG, not the <svg> element: a turned element is rasterized by the
     browser (soft, greyish edges, mostly Safari), a turned group is redrawn in every frame and stays sharp. -->
<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <g :class="{ spinning }">
      <path
        d="M12 3.8 16.56 2.54 15.56 4.61 20.21 5.45 18.41 6.89 22.24 9.66 19.99 10.18 22.24 14.34 19.99 13.82 20.21 18.55 18.41 17.11 16.56 21.46 15.56 19.39 12 22.5 12 20.2 7.44 21.46 8.44 19.39 3.79 18.55 5.59 17.11 1.76 14.34 4.01 13.82 1.76 9.66 4.01 10.18 3.79 5.45 5.59 6.89 7.44 2.54 8.44 4.61 12 1.5Z"
      />
      <circle cx="12" cy="12" r="2.5" />
    </g>
  </svg>
</template>

<style scoped>
@media (prefers-reduced-motion: no-preference) {
  .spinning {
    transform-box: view-box;
    transform-origin: 12px 12px;
    animation: saw-blade-turn 1.1s linear infinite;
  }
}

@keyframes saw-blade-turn {
  to {
    transform: rotate(360deg);
  }
}
</style>
