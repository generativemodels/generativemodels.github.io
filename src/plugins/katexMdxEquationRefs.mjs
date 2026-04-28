const katexBlockPattern = /^([ \t]*)\$\$\s*\n((?:(?!^\1\$\$).*\n)*)\1\$\$\s*<((?:eq|eq:|eq-)[A-Za-z0-9_:-]*)>\s*$/gm;

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default function katexMdxEquationRefs() {
  return {
    name: 'katex-mdx-equation-refs',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0].endsWith('.mdx')) return null;

      const equationNumbers = new Map();
      let nextEquationNumber = 1;
      let hasKatexBlocks = false;

      const withEquations = code.replace(katexBlockPattern, (_match, _indent, body, label) => {
        hasKatexBlocks = true;
        if (!equationNumbers.has(label)) {
          equationNumbers.set(label, nextEquationNumber++);
        }
        const number = equationNumbers.get(label);
        const escapedLabel = escapeHtml(label);

        return `<span id="${escapedLabel}" className="katex-equation-target" aria-hidden="true" style={{ display: 'block', height: 0, overflow: 'hidden', scrollMarginTop: '20vh' }}></span>
<div className="katex-equation" aria-label="Equation ${number}" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', columnGap: '0.75rem' }}>

$$
${body.trimEnd()}
$$

<span className="katex-equation-label" style={{ whiteSpace: 'nowrap', fontSize: '0.9rem', color: 'currentColor' }}>(${number})</span>
</div>`;
      });

      if (!hasKatexBlocks) return null;

      const withRefs = withEquations.replace(
        /(^|[^\w`])@((?:eq|eq:|eq-)[A-Za-z0-9_:-]*)\b/g,
        (match, prefix, label) => {
          const number = equationNumbers.get(label);
          if (!number) return match;
          return `${prefix}<a className="equation-ref" href="#${label}">Eq. (${number})</a>`;
        },
      );

      return {
        code: withRefs,
        map: null,
      };
    },
  };
}
