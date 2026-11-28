/**
 * Built-in example scores for Compare.
 * The SPEC demo endpoints cover prompts and traces only. There is no
 * comparison fixture to fetch, so these strings are labeled example input.
 * Statistics are never read from this file. They come from POST /api/compare.
 */
export const EXAMPLE_COMPARISON = {
  baseline: '0.82, 0.75, 0.91, 0.68, 0.77, 0.84, 0.73, 0.88',
  candidate: '0.61, 0.58, 0.70, 0.49, 0.66, 0.63, 0.55, 0.72',
} as const
