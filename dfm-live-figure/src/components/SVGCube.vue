<script setup lang="ts">
import { computed, ref } from 'vue'
import Color from 'colorjs.io'

interface CubeProps {
  size: number
  color: string
  x?: number,
  y?: number,
  z?: number,
  edgeColor?: string
  depth?: number
  text?: string
  rightText?: string
  topText?: string
  textColor?: string
  textSize?: number
  opacity?: number
}

const c = computed(() => new Color(props.color))
const cTop = computed(() => c.value.clone().lighten(0.15))
const cFront = computed(() => c.value.clone())
const cRight = computed(() => c.value.clone().darken(0.2))

const props = withDefaults(
  defineProps<CubeProps>(),
  {
    x: 0,
    y: 0,
    z: 0,
    size: 50,
    color: 'blue',
    edgeColor: 'black',
  }
)

const actualDepth = computed(() => props.depth ?? props.size / 2)
const actualTextSize = computed(() => props.textSize ?? props.size * 0.45)

const gBind = computed(() => (props.x || props.y || props.z) ? {
  transform: `translate(${props.x * props.size + props.z * actualDepth.value}, ${props.y * props.size - props.z * actualDepth.value})`
} : {})


const group = ref<SVGGElement | null>(null)
</script>
<template>
  <g ref="group" v-bind="gBind" :opacity="props.opacity ?? 1">
    <polygon
      :points="`0,0 ${props.size},0 ${props.size},${-props.size} 0,${-props.size}`"
      :fill="cFront.toString()"
      :stroke="props.edgeColor"
      stroke-width="2"
      :stroke-linejoin="'round'"
    />
    <polygon
      :points="`0,${-props.size} ${props.size},${-props.size} ${props.size + actualDepth},${-props.size - actualDepth} ${actualDepth},${-props.size - actualDepth}`"
      :fill="cTop.toString()"
      :stroke="props.edgeColor"
      stroke-width="2"
      :stroke-linejoin="'round'"
    />
    <polygon
      :points="`${props.size},0 ${props.size + actualDepth},${-actualDepth} ${props.size + actualDepth},${-props.size - actualDepth} ${props.size},${-props.size}`"
      :fill="cRight.toString()"
      :stroke="props.edgeColor"
      stroke-width="2"
      :stroke-linejoin="'round'"
    />
    <text v-if="$props.text"
      :x="props.size / 2"
      :y="-props.size / 2"
      text-anchor="middle"
      dominant-baseline="central"
      :fill="$props.textColor ?? (cFront.luminance > 0.5 ? 'black' : 'white')"
      :font-size="actualTextSize"
    >{{ props.text }}</text>
    <text v-if="$props.rightText"
      :x="props.size + actualDepth / 2"
      :y="-props.size / 2 - actualDepth / 2"
      text-anchor="middle"
      dominant-baseline="central"
      :fill="$props.textColor ?? (cRight.luminance > 0.5 ? 'black' : 'white')"
      :font-size="actualTextSize"
    >{{ props.rightText }}</text>
    <text v-if="$props.topText"
      :x="props.size / 2 + actualDepth / 2"
      :y="- props.size - actualDepth / 2"
      text-anchor="middle"
      dominant-baseline="central"
      :fill="$props.textColor ?? (cTop.luminance > 0.5 ? 'black' : 'white')"
      :font-size="actualTextSize"
    >{{ props.topText }}</text>
  </g>
</template>
