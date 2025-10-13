
type Counter = {
  map: Record<string, number>
  counter: number
  values: string[]
}

let counters = {} as Record<string, Counter>;

export function incrementCounter(type: string, name: string) {
  if (!counters[type]) {
    counters[type] = { map: {}, counter: 0, values: "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('') };
  }
  const ct = counters[type];
  ct.map[name] = ct.counter;
  ct.counter++;
  return ct.counter;
}

export function getCounterText(type: string, name: string) {
  const ct = counters[type]
  return ct.values[ct.map[name] ?? 0] ?? '?';
}

export function getCounterId(type: string, name: string) {
  return `${type}--${name.replace(/\s+/g, '-').toLowerCase()}`;
}

export function resetCounters() {
  counters = {};
}

export function resetCounter(type: string) {
  delete counters[type];
}