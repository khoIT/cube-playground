/**
 * Vite `?raw` imports of Markdown files — used by the What's New inbox to inline
 * the release-announcement files (src/pages/WhatsNew/releases/*.md) at build
 * time. The string is split into frontmatter + body by announcement-frontmatter.ts.
 */
declare module '*.md?raw' {
  const content: string;
  export default content;
}
