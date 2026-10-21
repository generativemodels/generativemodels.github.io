// Remark plugin that estimates reading time for a lesson.
//
// The estimate deliberately excludes:
//   - the content of every <details> ... </details> block (proofs,
//     derivations, "to go further" asides — collapsed by default), and
//   - everything from the "References" heading onwards (the bibliography).
//
// Figures (<Counter label="fig:..." />) carry no word count of their own, so
// each one adds a flat amount of viewing time instead.
//
// It exposes `minutesRead`, `wordCount` and `figureCount` on the Astro
// frontmatter, which `render()` returns as `remarkPluginFrontmatter`.

const WORDS_PER_MINUTE = 200;
const SECONDS_PER_FIGURE = 30;

// Node types whose textual value we count as prose.
const COUNTED_TEXT_TYPES = new Set(['text', 'inlineCode']);

// Recursively collect the plain text of a node (used to read heading titles).
function nodeText(node) {
	if (!node) return '';
	if (typeof node.value === 'string') return node.value;
	if (Array.isArray(node.children)) return node.children.map(nodeText).join('');
	return '';
}

function countWords(value) {
	const matches = value.match(/\S+/g);
	return matches ? matches.length : 0;
}

function isJsxElement(node) {
	return node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement';
}

function isDetails(node) {
	return isJsxElement(node) && node.name === 'details';
}

// A figure is a <Counter label="fig:..." /> marker.
function isFigure(node) {
	if (!isJsxElement(node) || node.name !== 'Counter') return false;
	const label = (node.attributes ?? []).find(
		(attr) => attr.type === 'mdxJsxAttribute' && attr.name === 'label',
	);
	return typeof label?.value === 'string' && label.value.startsWith('fig:');
}

export default function remarkReadingTime() {
	return function (tree, file) {
		let words = 0;
		let figures = 0;
		let inReferences = false;

		const walk = (node) => {
			if (!node || inReferences) return;

			// Stop counting once the bibliography starts.
			if (node.type === 'heading' && nodeText(node).trim().toLowerCase() === 'references') {
				inReferences = true;
				return;
			}

			// Skip collapsed <details> blocks entirely (including any figures inside).
			if (isDetails(node)) return;

			if (isFigure(node)) {
				figures += 1;
				return;
			}

			if (COUNTED_TEXT_TYPES.has(node.type) && typeof node.value === 'string') {
				words += countWords(node.value);
				return;
			}

			if (Array.isArray(node.children)) {
				for (const child of node.children) {
					walk(child);
					if (inReferences) break; // ignore siblings after the References heading
				}
			}
		};

		walk(tree);

		const seconds = (words / WORDS_PER_MINUTE) * 60 + figures * SECONDS_PER_FIGURE;
		const minutesRead = Math.max(1, Math.round(seconds / 60));

		const data = (file.data.astro ??= {});
		const frontmatter = (data.frontmatter ??= {});
		frontmatter.wordCount = words;
		frontmatter.figureCount = figures;
		frontmatter.minutesRead = minutesRead;
	};
}
