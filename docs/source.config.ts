import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { transformerTwoslash } from "fumadocs-twoslash";
import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import ts from "typescript";

// You can customize Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.dev/docs/mdx/collections
export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      transformers: [
        ...(rehypeCodeDefaultOptions.transformers ?? []),
        transformerTwoslash({
          twoslashOptions: {
            compilerOptions: {
              strict: true,
              moduleResolution: ts.ModuleResolutionKind.Bundler,
              module: ts.ModuleKind.ESNext,
              target: ts.ScriptTarget.ESNext,
              jsx: ts.JsxEmit.ReactJSX,
              baseUrl: ".",
              // Resolve the library from the monorepo source so docs
              // snippets always reflect the current types.
              paths: {
                resourcekit: ["../src/index.ts"],
                "resourcekit/react": ["../src/react/index.tsx"],
                "resourcekit/server": ["../src/server/index.ts"],
                "resourcekit/drizzle": ["../src/adapters/drizzle/index.ts"],
                "resourcekit/memory": ["../src/adapters/memory/index.ts"],
                "resourcekit/testing": ["../src/testing/contract.ts"],
              },
            },
          },
        }),
      ],
      // important: Shiki doesn't support lazy loading languages for codeblocks in Twoslash popups
      // make sure to define them first (e.g. the common ones)
      langs: ["js", "jsx", "ts", "tsx"],
    },
  },
});
