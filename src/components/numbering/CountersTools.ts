
type Counter = {
  map: Record<string, number>
  counter: number
}

let counters = {} as Record<string, Counter>;

const statementTypes = new Set(['def', 'lemma', 'prop', 'thm', 'cor', 'example'])
const figureTypes = new Set(['fig', 'table', 'tab', 'tbl'])

function getCounterGroup(type: string) {
  if (statementTypes.has(type)) return 'statement'
  if (figureTypes.has(type)) return 'figure'
  return type
}

function getCounterGroupKey(type: string, scope: string) {
  return `${scope}:${getCounterGroup(type)}`
}

function getCounterKey(type: string, name: string) {
  return `${type}:${name}`
}

export function ensureCounter(type: string, scope = 'global') {
  const group = getCounterGroupKey(type, scope)
  if (!counters[group]) {
    counters[group] = { map: {}, counter: 0 };
  }
  return counters[group];
}

export function incrementCounter(type: string, name: string, scope = 'global') {
  const ct = ensureCounter(type, scope);
  ct.map[getCounterKey(type, name)] = ct.counter;
  ct.counter++;
  return ct.counter;
}

export function getCounterText(type: string, name: string, scope = 'global') {
  const ct = ensureCounter(type, scope);
  return String((ct.map[getCounterKey(type, name)] ?? 0) + 1);
}

export function getCounterId(type: string, name: string) {
  return `${type}--${name.replace(/\s+/g, '-').toLowerCase()}`;
}

export function resetCounters() {
  counters = {};
}

export function resetCounter(type: string, scope = 'global') {
  delete counters[getCounterGroupKey(type, scope)];
}



////

export const jsSetupCounteurs = function(type: string) {
  const texts = {} as Record<string, string>;
  const statementTypes = ['def', 'lemma', 'prop', 'thm', 'cor', 'example'];
  const figureTypes = ['fig', 'table', 'tab', 'tbl'];
  const types = statementTypes.includes(type)
    ? statementTypes
    : figureTypes.includes(type)
      ? figureTypes
      : [type];
  const counterSelector = types.map((t) => `.counter--${t}`).join(',');
  const refSelector = types.map((t) => `.counter-ref--${t}`).join(',');

  document.querySelectorAll(counterSelector).forEach((el, index) => {
    const label = `${el.getAttribute('data-type')}:${el.getAttribute('data-name')}`;
    const text = String(index + 1);
    texts[label] = text;
    el.textContent = text;
    el.setAttribute('data-text', text);
  });
  document.querySelectorAll(refSelector).forEach(el => {
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
