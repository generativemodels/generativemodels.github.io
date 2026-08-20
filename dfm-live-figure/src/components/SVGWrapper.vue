<template>
  <div class="svg-wrapper">
    <svg ref="svg"
    :width="width" :height="height"
    :viewBox="viewBox"
    @mousedown="passEvent('mousedown', $event)"
    @mouseup="passEvent('mouseup', $event)"
    @mousemove="passEvent('mousemove', $event)"
    @click="passEvent('click', $event)"
    >
      <slot></slot>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

interface Props {
  width?: number
  height?: number
  domain: [number, number, number, number]
}
const emit = defineEmits<{
  click: [MouseEvent, number, number],
  mousemove: [MouseEvent, number, number],
  mouseup: [MouseEvent, number, number],
  mousedown: [MouseEvent, number, number],
}>()

function passEvent(eventName: 'click' | 'mousemove' | 'mouseup' | 'mousedown', event: MouseEvent) {
  if (!svg.value) return
  const [x1, y1, x2, y2] = props.domain
  const xInDomain = x1 + (x2 - x1) * event.offsetX / svg.value.clientWidth
  const yInDomain = y1 + (y2 - y1) * event.offsetY / svg.value.clientHeight
  emit(eventName as any, event, xInDomain, yInDomain)
}

const props = defineProps<Props>()

const svg = ref<SVGSVGElement | null>(null)

const viewBox = computed(() => {
  const [x1, y1, x2, y2] = props.domain
  const width = x2 - x1
  const height = y2 - y1
  return `${x1} ${y1} ${width} ${height}`
})
</script>

<style scoped>
.svg-wrapper {
  position: relative;
}
</style>
