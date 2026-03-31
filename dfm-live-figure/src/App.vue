<script setup lang="tsx">
import { computed, watch } from 'vue'
import SVGCube from './components/SVGCube.vue'
import D3Wrapper from './components/SVGWrapper.vue'
import { computedStringFromList, useDFMStore, MAX_SEQ_LENGTH } from './stores/dfm-state'
import Color from 'colorjs.io'
import { useRafFn } from '@vueuse/core'

const margin = 30
const size = 50
const depth = 25

const state = useDFMStore()
const x1str = computedStringFromList(state, 'x1')

function tokenIndexColor(index: number): string {
  return `lch(30% 100 ${(20 + index * 360) / state.vocabulary.length})`
}
function tokenColor(token: string): string {
  const index = state.vocabulary.findIndex((t) => t === token)
  return tokenIndexColor(index)
}

// SVG domain: dynamic based on actual content, clamped to reasonable bounds
const svgDomain = computed<[number, number, number, number]>(() => {
  const vocabSize = state.masked ? state.vocabulary.length + 1 : state.vocabulary.length
  const seqLen = Math.max(state.x1L, 3) // floor at 3 so tiny inputs don't explode
  const rightX = (state.horizontalBins + 2) * size + seqLen * depth + margin
  const topY = Math.max(vocabSize, 3) * size + seqLen * depth + margin
  return [
    -margin,
    -topY,
    rightX,
    margin,
  ]
})

// Play/pause animation using requestAnimationFrame
const { pause: pauseRaf, resume: resumeRaf } = useRafFn(
  ({ delta }) => {
    if (!state.playing) return
    const increment = state.animationSpeed * (delta / 16.67)
    state.t = Math.min(1, state.t + increment)
    if (state.t >= 1) {
      state.playing = false
    }
  },
  { immediate: false },
)

watch(
  () => state.playing,
  (isPlaying) => {
    if (isPlaying) {
      if (state.t >= 1) state.t = 0
      resumeRaf()
    } else {
      pauseRaf()
    }
  },
)

function togglePlay() {
  state.playing = !state.playing
}

function resetAnimation() {
  state.playing = false
  state.t = 0
}

const ProbTable = ({
  prob,
  x = 0,
  y = 0,
  z = 0,
  frontFacing = false,
  transparentMask = false,
  hideLowP = false,
}: {
  prob: number[][]
  x?: number
  y?: number
  z?: number
  frontFacing?: boolean
  transparentMask?: boolean
  hideLowP?: boolean
}) => {
  const colorScales = state.vocabulary.map((_, iv) =>
    new Color('white').range(new Color(tokenIndexColor(iv))),
  )
  const outOfVocabularyColor = new Color('white').range(new Color('#555'))
  const data = frontFacing ? prob : prob.slice().reverse()
  return (
    <g class={`onehot-table`}>
      {data.map((ps, is) =>
        ps
          .slice()
          .reverse()
          .map((p, iv) => {
            const isMaskCube = (ps.length - 1 - iv) >= state.vocabulary.length
            const cubeOpacity = transparentMask ? (isMaskCube ? 0 : p) : (hideLowP ? p : 1)
            if (cubeOpacity < 0.01) return null
            return (
              <SVGCube
                key={`${is}-${iv}`}
                x={frontFacing ? x + is : x}
                y={y - iv}
                z={frontFacing ? z : z + prob.length - is - 1}
                size={size}
                depth={depth}
                color={(colorScales[ps.length - 1 - iv] ?? outOfVocabularyColor)(p).toString()}
                opacity={cubeOpacity}
              />
            )
          }),
      )}
    </g>
  )
}
</script>
<template>
  <div class="dfm-card">
    <h2 class="dfm-title">Conditional Probability Paths</h2>

    <D3Wrapper class="svg-vis" :class="{ 'dense-xprobat': state.showTransparentMask && state.showXfocuseprobat && state.masked && state.x1IsDecreasing }" :domain="svgDomain">
      <ProbTable :prob="state.x0proba" class="proba x0proba" :x="0" />
      <ProbTable
        v-if="!state.showXfocuseprobat"
        :prob="state.xtproba"
        class="proba xtproba"
        :x="state.t * state.horizontalBins"
      />
      <template v-else>
        <!-- Full cube: all positions, mask row only on position 0 -->
        <template v-if="state.showTransparentMask && state.masked && state.x1IsDecreasing">
          <ProbTable
            v-for="(posProba, posIdx) in [...state.xAllPositionsProbat].reverse()"
            :key="posIdx"
            :prob="posProba.slice(1)"
            class="proba xfocusprobat"
            :x="1"
            :z="state.xAllPositionsProbat.length - 1 - posIdx"
            :frontFacing="true"
            :transparentMask="posIdx !== state.xAllPositionsProbat.length - 1"
            :hideLowP="true"
          />
        </template>
        <!-- Default: only selected position -->
        <ProbTable
          v-else
          :prob="state.xfocusprobat.slice(1)"
          class="proba xfocusprobat"
          :x="1"
          :z="state.sequencePositionOfInterest"
          :frontFacing="true"
        />
      </template>
      <ProbTable :prob="state.x1onehot" class="proba x1onehot" :x="state.horizontalBins" />
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="0" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="darkred" />
        </marker>
      </defs>
    </D3Wrapper>

    <div class="controls-bar">
      <label class="input-label">
        <span class="label-text">x₁</span>
        <input type="text" v-model="x1str" class="text-input" />
      </label>

      <div class="toggle-group">
        <button :class="['toggle-btn', { active: state.masked }]" @click="state.masked = true">
          Masked
        </button>
        <button :class="['toggle-btn', { active: !state.masked }]" @click="state.masked = false">
          Uniform
        </button>
      </div>

      <label v-if="!state.showXfocuseprobat" class="slider-label">
        <span class="label-text">t = {{ state.t.toFixed(2) }}</span>
        <input
          type="range"
          v-model.number="state.t"
          :min="0"
          :max="1"
          step="0.001"
          class="slider"
          @input="state.playing = false"
        />
      </label>
      <label v-else-if="!(state.showTransparentMask && state.masked)" class="slider-label">
        <span class="label-text">pos {{ state.sequencePositionOfInterest }}</span>
        <input
          type="range"
          v-model="state.sequencePositionOfInterest"
          :min="0"
          :max="state.x1L - 1"
          step="1"
          class="slider"
        />
      </label>

      <div v-if="!state.showXfocuseprobat" class="playback-controls">
        <button class="btn play-btn" :class="{ playing: state.playing }" @click="togglePlay">
          {{ state.playing ? '⏸ Pause' : '▶ Play' }}
        </button>
        <button class="btn reset-btn" @click="resetAnimation">Reset</button>
      </div>
    </div>

    <label class="checkbox-label">
      <input type="checkbox" v-model="state.showXfocuseprobat" />
      <span class="label-text">Show per-position probability over time</span>
    </label>

    <label v-if="state.showXfocuseprobat && state.masked" class="checkbox-label">
      <input type="checkbox" v-model="state.showTransparentMask" :disabled="!state.x1IsDecreasing" />
      <span class="label-text">Show full cube <span v-if="!state.x1IsDecreasing" style="opacity: 0.5">(requires x₁ in decreasing order)</span></span>
    </label>

    <div v-if="!state.showXfocuseprobat" class="samples-section">
      <h2 class="samples-title">Samples from conditional probability paths</h2>
      <div class="samples-list">
        <div v-for="(sample, idx) in state.sampledStrings" :key="idx" class="sample-row">
          <span
            v-for="(token, pos) in sample"
            :key="pos"
            class="sample-token"
            :style="{ color: token === state.maskToken ? 'rgba(255,255,255,0.35)' : tokenColor(token) }"
          >{{ token === state.maskToken ? 'm' : token }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.dense-xprobat .xfocusprobat g>polygon:nth-child(3n) {
  opacity: 0;
}

html, body, #app {
  margin: 0;
  padding: 0;
}

* {
  box-sizing: border-box;
}

svg {
  border: none;
  display: block;
}

.svg-vis {
  width: 100%;
}

.svg-vis :deep(svg) {
  width: 100%;
  height: auto;
}

.dfm-card {
  background: radial-gradient(ellipse at 35% 15%, #0f1729, #080d18 55%, #050810);
  color: white;
  font-family: 'Outfit', sans-serif;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 16px 20px;
  gap: 10px;
  border-radius: 16px;
  max-width: 960px;
  margin: 0 auto;
}

.dfm-title {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, #82b4ff, #a78bfa, #7defa0);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.proba {
  filter: saturate(50%);
}

.xfocusprobat,
.xtproba {
  filter: drop-shadow(0 0 10px red);
}

.x0proba,
.x1onehot {
  opacity: 0.5;
}

/* Controls bar */
.controls-bar {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
  width: 100%;
}

.input-label,
.slider-label,
.checkbox-label {
  font-family: 'DM Mono', monospace;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  display: flex;
  align-items: center;
  gap: 6px;
}

.label-text {
  white-space: nowrap;
}

.text-input {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: #fff;
  padding: 5px 10px;
  font-family: 'DM Mono', monospace;
  font-size: 13px;
  width: 80px;
}

.text-input:focus {
  outline: none;
  border-color: rgba(167, 139, 250, 0.4);
}

/* Slider */
.slider {
  -webkit-appearance: none;
  appearance: none;
  width: 140px;
  height: 4px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  outline: none;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #a78bfa;
  cursor: pointer;
}

.slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #a78bfa;
  cursor: pointer;
  border: none;
}

/* Toggle group (Masked / Uniform) */
.toggle-group {
  display: inline-flex;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.toggle-btn {
  padding: 6px 16px;
  border: none;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.4);
  font-family: 'DM Mono', monospace;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.toggle-btn:first-child {
  border-right: 1px solid rgba(255, 255, 255, 0.08);
}

.toggle-btn.active {
  background: rgba(167, 139, 250, 0.18);
  color: #a78bfa;
  font-weight: 600;
}

/* Playback buttons */
.playback-controls {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 6px 16px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: #fff;
  cursor: pointer;
  font-family: 'DM Mono', monospace;
  font-size: 13px;
  transition: background 0.2s, border-color 0.2s;
}

.play-btn {
  border-color: rgba(125, 239, 160, 0.3);
  background: rgba(125, 239, 160, 0.08);
  color: #7defa0;
  font-weight: 600;
  min-width: 90px;
}

.play-btn.playing {
  border-color: rgba(221, 132, 82, 0.4);
  background: rgba(221, 132, 82, 0.12);
  color: #dd8452;
}

.reset-btn {
  color: rgba(255, 255, 255, 0.45);
}

.reset-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.checkbox-label input[type='checkbox'] {
  accent-color: #a78bfa;
}

/* Samples section */
.samples-section {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 4px;
}

.samples-title {
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 10px;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, #82b4ff, #a78bfa, #7defa0);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.samples-list {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.sample-row {
  font-family: 'DM Mono', monospace;
  font-size: 16px;
  letter-spacing: 0.15em;
  display: flex;
  gap: 2px;
}

.sample-token {
  font-weight: 600;
}
</style>
