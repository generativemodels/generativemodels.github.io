import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export const MAX_SEQ_LENGTH = 10

export const useDFMStore = defineStore('dfm', () => {
  const x1 = ref('hello'.split(''))
  const forceVocabulay = ref([]) // ref("abcde".split("")) // | []
  const vocabulary = computed(() =>
    forceVocabulay.value.length === 0 ? [...new Set(x1.value)].sort() : forceVocabulay.value,
  )

  const x1onehot = computed(() =>
    x1.value.map((t) => masked.value ? [...vocabulary.value.map((v) => (t === v ? 1 : 0)), 0] : vocabulary.value.map((v) => (t === v ? 1 : 0))),
  )
  const masked = ref(true)
  const x0proba = computed(() =>
    x1.value.map((t) =>
      masked.value
        ? [...vocabulary.value.map((v) => 0), 1]
        : vocabulary.value.map(() => 1 / vocabulary.value.length),
    ),
  )

  const t = ref(0.)
  const xtproba = computed(() =>
    x0proba.value.map((proba, is) =>
      proba.map((p, iv) => p * (1 - t.value) + t.value * x1onehot.value[is][iv]),
    ),
  )

  const horizontalBins = ref(20)
  const sequencePositionOfInterest = ref(0)
  const xfocusprobat = computed(() => {
    const is = sequencePositionOfInterest.value
    // create time bins, just consider first token in sequence
    return Array.from({ length: horizontalBins.value }, (_, i) => {
      const t = i / horizontalBins.value
      return x0proba.value[is].map((p, iv) => p * (1 - t) + t * x1onehot.value[is][iv])
    })
  })

  const playing = ref(false)
  const animationSpeed = ref(0.002)

  return {
    // data state
    x1,
    vocabulary,
    x1L: computed(() => x1.value.length),
    x1onehot,
    masked,
    x0proba,
    t,
    xtproba,
    horizontalBins,
    xfocusprobat,
    sequencePositionOfInterest,

    // playback state
    playing,
    animationSpeed,

    // render state
    showX0: ref(true),
    showX1seq: ref(true),
    showX1onehot: ref(true),
    showXfocuseprobat: ref(false),
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
