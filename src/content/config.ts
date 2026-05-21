import { defineCollection, z } from 'astro:content';

const works = defineCollection({
  schema: ({ image }) => z.object({
    title: z.string(),
    series: z.string(),
    images: z.array(image()),
    year: z.number().optional(),
    medium: z.string().optional(),
    dimensions: z.string().optional(),
    description: z.string().optional(),
    featured: z.boolean().default(false),
    order: z.number().default(0)
  })
});

const series = defineCollection({
  schema: ({ image }) => z.object({
    title: z.string(),
    description: z.string().optional(),
    cover_image: image(),
    order: z.number().default(0)
  })
});

const events = defineCollection({
  schema: ({ image }) => z.object({
    title: z.string(),
    title_en: z.string().optional(),
    venue: z.string(),
    venue_en: z.string().optional(),
    city: z.string(),
    city_en: z.string().optional(),
    type: z.enum(['performance', 'exhibition']).default('exhibition'),
    date_start: z.date(),
    date_end: z.date().optional(),
    preview_image: image().optional(),
    link: z.string().optional(),
    has_detail: z.boolean().default(false),
    detail_content: z.string().optional()
  })
});

const pages = defineCollection({
  schema: z.object({
    title: z.string()
  })
});

export const collections = { works, series, events, pages };
