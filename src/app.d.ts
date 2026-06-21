// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

// Fontsource CSS side-effect imports (no explicit TypeScript declarations)
declare module '@fontsource-variable/ibm-plex-sans';
declare module '@fontsource-variable/ibm-plex-sans/wght-italic.css';
declare module '@fontsource/ibm-plex-mono/400.css';
declare module '@fontsource/ibm-plex-mono/700.css';
// Vite ?url imports for font WOFF2 files
declare module '*?url' {
  const url: string;
  export default url;
}

export {};
