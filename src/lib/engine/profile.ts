import {
  fabricProfile,
  threadDensityMul,
  type FabricProfile,
  type FabricType,
  type ThreadWeight,
} from "../../types/project";

/**
 * The single source of truth that folds the project's fabric AND thread weight
 * into one effective profile the stitch generators consume. Keeping this in one
 * place means every generator (satin, fill, underlay) sees the same resolved
 * density/pull/underlay/stitch-length modifiers.
 *
 * Today it composes:
 *  - the fabric's density/pull/underlay/stitch-length modifiers, and
 *  - the thread weight's row-spacing modifier (thinner thread → denser rows).
 *
 * Later phases extend the profile (knockdown for pile, per-width pull curves);
 * adding them here keeps the generators unchanged.
 */
export function effectiveProfile(
  fabric: FabricType | undefined,
  threadWeight: ThreadWeight | undefined,
): FabricProfile {
  const base = fabricProfile(fabric);
  return {
    ...base,
    // Thread weight only tightens/loosens the row gap; it doesn't change pull or
    // underlay weight (those track fabric stretch/loft, not thread thickness).
    densityMul: base.densityMul * threadDensityMul(threadWeight),
  };
}
