/**
 * Vite `?raw` imports of YAML files — used by the Segments preset modules to
 * inline the shared preset bundles (server/src/presets/bundles/*.yml) at build
 * time. The string is parsed with js-yaml at module load.
 */
declare module '*.yml?raw' {
  const content: string;
  export default content;
}
