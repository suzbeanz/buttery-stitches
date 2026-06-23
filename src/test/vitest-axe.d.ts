// Teach TypeScript about vitest-axe's custom matcher (toHaveNoViolations) on
// vitest's expect. vitest-axe ships a global `Vi`-namespace augmentation that
// vitest 2's `expect` types don't read, so augment the "vitest" module directly.
// Empty interfaces are how matcher libraries merge their methods in.
/* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any */
import type { AxeMatchers } from "vitest-axe/matchers";

declare module "vitest" {
  interface Assertion<_T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
