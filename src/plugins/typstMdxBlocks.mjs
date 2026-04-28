import path from 'node:path';

const typstBlockPattern = /^([ \t]*)\$\s*\n([\s\S]*?)\n\1\$\s*<([A-Za-z][\w:-]*)>\s*$/gm;

function componentImportPath(id) {
  const filePath = id.split('?')[0];
  const componentPath = path.resolve(process.cwd(), 'src/components/typst/TypstEquation.astro');
  let relativePath = path.relative(path.dirname(filePath), componentPath).split(path.sep).join('/');
  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }
  return relativePath;
}

function injectImports(code, id) {
  const importLine = `import TypstEquation from '${componentImportPath(id)}';\n`;
  if (code.includes("components/typst/TypstEquation.astro")) return code;

  const frontmatter = code.match(/^---\s*\n[\s\S]*?\n---\s*\n/);
  if (frontmatter) {
    return code.slice(0, frontmatter[0].length) + importLine + code.slice(frontmatter[0].length);
  }
  return importLine + code;
}

function escapeForJsxExpression(value) {
  return JSON.stringify(value);
}

export default function typstMdxBlocks() {
  return {
    name: 'typst-mdx-blocks',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0].endsWith('.mdx')) return null;

      const equationNumbers = new Map();
      let nextEquationNumber = 1;
      let hasTypstBlocks = false;

      const withEquations = code.replace(typstBlockPattern, (_match, _indent, body, label) => {
        hasTypstBlocks = true;
        if (!equationNumbers.has(label)) {
          equationNumbers.set(label, nextEquationNumber++);
        }
        const number = equationNumbers.get(label);
        return `<TypstEquation label="${label}" number="${number}" v={${escapeForJsxExpression(body)}} />`;
      });

      if (!hasTypstBlocks) return null;

      const withRefs = withEquations.replace(
        /(^|[^\w`])@((?:eq|eq:|eq-)[A-Za-z0-9_:-]*)\b/g,
        (match, prefix, label) => {
          const number = equationNumbers.get(label);
          if (!number) return match;
          return `${prefix}<a className="equation-ref" href="#${label}">Eq. (${number})</a>`;
        },
      );

      return {
        code: injectImports(withRefs, id),
        map: null,
      };
    },
  };
}
