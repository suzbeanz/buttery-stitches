import { describe, it, expect } from "vitest";
import { resolveParams, DEFAULT_PARAMS } from "./project";

describe("resolveParams", () => {
  it("defaults outline to true (objects show a border)", () => {
    expect(resolveParams("fill", {}).outline).toBe(true);
    expect(DEFAULT_PARAMS.outline).toBe(true);
  });

  it("respects an explicit outline=false", () => {
    expect(resolveParams("fill", { outline: false }).outline).toBe(false);
  });

  it("still forces running stitches to have no underlay", () => {
    expect(resolveParams("running", { underlay: true }).underlay).toBe(false);
  });
});
