/**
 * Vite `?raw` imports of YAML files — used by the Segments preset modules to
 * inline the shared preset bundles (server/src/presets/bundles/*.yml) at build
 * time. The string is parsed with js-yaml at module load.
 */
declare module '*.yml?raw' {
  const content: string;
  export default content;
}

// Feature Atlas spine (src/feature-atlas/atlas.yaml) is loaded as a raw string and
// parsed with js-yaml at module load (src/pages/Atlas/atlas-data.ts).
declare module '*.yaml?raw' {
  const content: string;
  export default content;
}
