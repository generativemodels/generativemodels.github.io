import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'

export const MAX_SEQ_LENGTH = 10
const NUM_SAMPLES = 5

// Seeded PRNG (mulberry32) for reproducible samples
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Sample from a categorical distribution given probabilities
function sampleCategorical(probs: number[], rng: () => number): number {
  if (probs.length === 0) return 0
  const r = rng()
  let cumSum = 0
  for (let i = 0; i < probs.length; i++) {
    cumSum += probs[i] ?? 0
    if (r < cumSum) return i
  }
  return probs.length - 1
}

export const useDFMStore = defineStore('dfm', () => {
  const x1 = ref('spoon'.split(''))
  const forceVocabulay = ref([]) // ref("abcde".split("")) // | []
  const vocabulary = computed(() =>
    forceVocabulay.value.length === 0 ? [...new Set(x1.value)].sort() : forceVocabulay.value,
  )

  const x1onehot = computed(() =>
    x1.value.map((t) =>
      masked.value
        ? [...vocabulary.value.map((v) => (t === v ? 1 : 0)), 0]
        : vocabulary.value.map((v) => (t === v ? 1 : 0)),
    ),
  )
  const masked = ref(true)
  const maskToken = '▮'
  const x0proba = computed(() =>
    x1.value.map((t) =>
      masked.value
        ? [...vocabulary.value.map((v) => 0), 1]
        : vocabulary.value.map(() => 1 / vocabulary.value.length),
    ),
  )

  const t = ref(0)
  const xtproba = computed(() =>
    x0proba.value.map((proba, is) => {
      const targetProba = x1onehot.value[is] ?? []
      return proba.map((p, iv) => p * (1 - t.value) + t.value * (targetProba[iv] ?? 0))
    }),
  )

  const horizontalBins = ref(20)
  const sequencePositionOfInterest = ref(0)
  const xfocusprobat = computed(() => {
    const is = sequencePositionOfInterest.value
    const startProba = x0proba.value[is] ?? x0proba.value[0] ?? []
    const targetProba = x1onehot.value[is] ?? x1onehot.value[0] ?? []
    // create time bins, just consider first token in sequence
    return Array.from({ length: horizontalBins.value }, (_, i) => {
      const t = i / horizontalBins.value
      return startProba.map((p, iv) => p * (1 - t) + t * (targetProba[iv] ?? 0))
    })
  })

  // xfocusprobat for all positions (used when showing full cube)
  const xAllPositionsProbat = computed(() =>
    Array.from({ length: x1.value.length }, (_, is) => {
      const startProba = x0proba.value[is] ?? []
      const targetProba = x1onehot.value[is] ?? []
      return Array.from({ length: horizontalBins.value }, (_, i) => {
        const t = i / horizontalBins.value
        return startProba.map((p, iv) => p * (1 - t) + t * (targetProba[iv] ?? 0))
      })
    }),
  )

  const playing = ref(false)
  const animationSpeed = ref(0.002)

  // Vocabulary labels including mask token if applicable
  const vocabLabels = computed(() =>
    masked.value ? [...vocabulary.value, maskToken] : [...vocabulary.value],
  )

  // Draw NUM_SAMPLES samples from the conditional probability path at current t
  // q_t(x^i | x_0^i, x_1^i) = t * I(x = x_1) + (1 - t) * I(x = x_0)
  // Each coordinate is drawn independently from Cat(xtproba[position])
  const sampledStrings = computed(() => {
    const proba = xtproba.value
    const labels = vocabLabels.value
    return Array.from({ length: NUM_SAMPLES }, (_, sampleIdx) => {
      const rng = mulberry32(sampleIdx * 1000 + Math.round(t.value * 10000))
      return proba.map((posProba) => {
        const idx = sampleCategorical(posProba, rng)
        return labels[idx] ?? maskToken
      })
    })
  })

  // Show transparent mask cubes in per-position view
  const showTransparentMask = ref(false)

  // x1 characters are in decreasing order
  const x1IsDecreasing = computed(() =>
    x1.value.every((c, i) => i === 0 || (x1.value[i - 1] ?? '') >= c),
  )

  // Auto-untick full cube when condition becomes invalid
  watch(x1IsDecreasing, (valid) => {
    if (!valid) showTransparentMask.value = false
  })

  return {
    // data state
    x1,
    vocabulary,
    vocabLabels,
    maskToken,
    x1L: computed(() => x1.value.length),
    x1onehot,
    masked,
    x0proba,
    t,
    xtproba,
    horizontalBins,
    xfocusprobat,
    xAllPositionsProbat,

    sequencePositionOfInterest,
    sampledStrings,

    // playback state
    playing,
    animationSpeed,

    // render state
    showX0: ref(true),
    showX1seq: ref(true),
    showX1onehot: ref(true),
    showXfocuseprobat: ref(false),
    showTransparentMask,
    x1IsDecreasing,
  }
})

export function computedStringFromList(store: any, key: string) {
  return computed({
    get() {
      return store[key].join('')
    },
    set(value: string) {
      store[key] = value.slice(0, MAX_SEQ_LENGTH).split('')
    },
  })
}
