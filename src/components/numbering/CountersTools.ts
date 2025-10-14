
type Counter = {
  map: Record<string, number>
  counter: number
  values: string[]
}

let counters = {} as Record<string, Counter>;

export function ensureCounter(type: string) {
  if (!counters[type]) {
    counters[type] = { map: {}, counter: 0, values: "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('') };
  }
  return counters[type];
}

export function incrementCounter(type: string, name: string) {
  const ct = ensureCounter(type);
  ct.map[name] = ct.counter;
  ct.counter++;
  return ct.counter;
}

export function getCounterText(type: string, name: string) {
  const ct = ensureCounter(type);
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



////

export const jsSetupCounteurs = function(type: string) {
  const texts = {} as Record<string, string>;
  document.querySelectorAll(`.counter--${type}`).forEach(el => {
    const label = `${el.getAttribute('data-type')}:${el.getAttribute('data-name')}`;
    texts[label] = el.getAttribute('data-text') || '';
  });
  document.querySelectorAll(`.counter-ref--${type}`).forEach(el => {
    const label = `${el.getAttribute('data-type')}:${el.getAttribute('data-name')}`;
    if (texts[label]) {
      el.textContent = texts[label];
      el.setAttribute('data-text', texts[label]);
    }
  });
}

export const jsOnLoadSetupCounters = function(type: string) {
  return `window.addEventListener('load', () => { (${jsSetupCounteurs.toString()})('${type}') })`;
}
