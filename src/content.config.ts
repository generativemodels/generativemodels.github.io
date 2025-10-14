import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { typstable } from './consts.ts';

const lessons = defineCollection({
	// Load Markdown and MDX files in the `src/content/lessons/` directory.
	loader: glob({ base: './src/content/lessons', pattern: '**/*.{md,mdx}' }),
	// Type-check frontmatter using a schema
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			// Transform string to Date object
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			heroImage: image().optional(),
			order: z.number().optional(),
			tags: z.array(z.string()).optional(),
			menu: z.string().optional(),
			typst: z.union([z.enum(typstable), z.array(z.enum(typstable))]).optional(),
		}),
});

export const collections = { lessons };
