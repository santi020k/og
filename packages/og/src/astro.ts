/**
 * Compatibility aliases for the original Astro entry point.
 * The implementation is framework-neutral and also available from `@santi020k/og/content`.
 */
export {
  type ContentCardOptions as AstroContentCardOptions,
  type ContentEntry as AstroContentEntry,
  collectContentCards as collectAstroContentCards,
  readContent as readAstroContent
} from './content.js'
