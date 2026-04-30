const equationLabelSource = 'eq:[A-Za-z0-9_:-]*';
const katexBlockPattern = new RegExp(
  `^([ \\t]*)\\$\\$\\s*\\n((?:(?!^\\1\\$\\$).*\n)*)\\1\\$\\$\\s*$`,
  'gm',
);
const labelCommandPattern = new RegExp(`\\\\label\\{(${equationLabelSource})\\}`, 'g');
const displayEnvironmentPattern = /\\begin\{(?:equation\*?|align\*?|gather\*?|alignat\*?|aligned|alignedat|gathered|split)\}/;
const manualTagPattern = /\\tag\*?\{/;
const refPattern = new RegExp(`(^|[^\\w\`])@(${equationLabelSource})\\b`, 'g');

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function equationMarker(label) {
  return `\\htmlData{equation-label=${label}}{\\htmlId{${label}}{}}`;
}

function wrapInEquation(body) {
  return `\\begin{equation}
${body.trimEnd()}
\\end{equation}
`;
}

function addLabel(labelRefs, label) {
  labelRefs.set(label, label);
}

export default function katexMdxEquationRefs() {
  return {
    name: 'katex-mdx-equation-refs',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0].endsWith('.mdx')) return null;

      const labelRefs = new Map();
      let hasKatexBlocks = false;

      const withEquations = code.replace(katexBlockPattern, (_match, indent, body) => {
        hasKatexBlocks = true;
        let hasBodyLabels = false;

        let nextBody = body.replace(labelCommandPattern, (_labelMatch, label) => {
          addLabel(labelRefs, label);
          hasBodyLabels = true;
          return equationMarker(label);
        });

        if (hasBodyLabels && !displayEnvironmentPattern.test(nextBody) && !manualTagPattern.test(nextBody)) {
          nextBody = wrapInEquation(nextBody);
        }

        return `${indent}$$
${nextBody.trimEnd()}
${indent}$$`;
      });

      if (!hasKatexBlocks || labelRefs.size === 0) return null;

      const withRefs = withEquations.replace(refPattern, (match, prefix, label) => {
        const targetLabel = labelRefs.get(label);
        if (!targetLabel) return match;
        const escapedLabel = escapeHtml(targetLabel);
        return `${prefix}<a className="equation-ref" href="#${escapedLabel}" data-equation-ref="${escapedLabel}">Eq. (?)</a>`;
      });

      return {
        code: withRefs,
        map: null,
      };
    },
  };
}
