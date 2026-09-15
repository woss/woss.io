/**
 * Test-only ambient declaration.
 *
 * Some component tests import the Svelte 5 client runtime directly
 * (`svelte/internal/client`) to force client-build APIs (mount/unmount)
 * inside node. The package ships no types for that subpath; keep it
 * permissive since the tests only need the runtime functions.
 */
declare module 'svelte/internal/client';
