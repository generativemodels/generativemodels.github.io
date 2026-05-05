
type Counter = {
  map: Record<string, number>
  counter: number
}

let counters = {} as Record<string, Counter>;

const statementTypes = new Set(['def', 'lemma', 'prop', 'thm', 'cor'])

function getCounterGroup(type: string) {
  return statementTypes.has(type) ? 'statement' : type
}

function getCounterKey(type: string, name: string) {
  return `${type}:${name}`
}

export function ensureCounter(type: string) {
  const group = getCounterGroup(type)
  if (!counters[group]) {
    counters[group] = { map: {}, counter: 0 };
  }
  return counters[group];
}

export function incrementCounter(type: string, name: string) {
  const ct = ensureCounter(type);
  ct.map[getCounterKey(type, name)] = ct.counter;
  ct.counter++;
  return ct.counter;
}

export function getCounterText(type: string, name: string) {
  const ct = ensureCounter(type);
  return String((ct.map[getCounterKey(type, name)] ?? 0) + 1);
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
