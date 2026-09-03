import { describe, it, expect } from "vitest";
import { priorityDefaults, applyPriorityParams } from "./digitizePriority";
import type { EmbObject } from "../types/project";

const fill = (params: EmbObject["params"] = {}): EmbObject => ({
  id: "o1",
  name: "Red fill",
  type: "fill",
  colorId: "c1",
  paths: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]],
  params,
  visible: true,
});

describe("priorityDefaults", () => {
  it("balanced is a strict pass-through of the long-standing defaults", () => {
    const d = priorityDefaults("balanced", 4);
    expect(d).toEqual({ colorCount: 4, detail: "balanced", outline: true, recognizeText: false });
    expect(d.density).toBeUndefined();
  });

  it("crisp lettering: detailed trace + text recognition on, colors untouched", () => {
    const d = priorityDefaults("lettering", 5);
    expect(d.detail).toBe("detailed");
    expect(d.recognizeText).toBe(true);
    expect(d.colorCount).toBe(5);
    expect(d.density).toBeUndefined();
    expect(d.outline).toBe(true);
  });

  it("solid coverage: tighter rows, still solid-family, nothing else biased", () => {
    const d = priorityDefaults("coverage", 4);
    expect(d.density).toBeLessThan(0.3); // tighter than the engine default
    expect(d.density!).toBeGreaterThan(0.1); // sane, not machine-melting
    expect(d.density!).toBeLessThan(0.6); // solid family, never sketch spacing
    expect(d.detail).toBe("balanced");
    expect(d.colorCount).toBe(4);
    expect(d.recognizeText).toBe(false);
  });

  it("fewer stitches: smoother trace, lighter rows, one fewer thread (capped), outline off", () => {
    const d = priorityDefaults("economy", 4);
    expect(d.detail).toBe("smooth");
    expect(d.density).toBeGreaterThan(0.3); // lighter than the engine default
    expect(d.density!).toBeLessThan(0.6); // but still solid-family
    expect(d.colorCount).toBe(3);
    expect(d.outline).toBe(false);
  });

  it("economy color trim floors at 2 and caps at 6", () => {
    expect(priorityDefaults("economy", 2).colorCount).toBe(2);
    expect(priorityDefaults("economy", 3).colorCount).toBe(2);
    expect(priorityDefaults("economy", 12).colorCount).toBe(6);
  });
});

describe("applyPriorityParams", () => {
  it("balanced returns the SAME object reference — byte-identical auto path", () => {
    const o = fill();
    expect(applyPriorityParams(o, priorityDefaults("balanced", 4))).toBe(o);
  });

  it("coverage stamps density on a plain fill; economy stamps density + outline:false", () => {
    const cov = applyPriorityParams(fill(), priorityDefaults("coverage", 4));
    expect(cov.params.density).toBe(priorityDefaults("coverage", 4).density);
    expect(cov.params.outline).toBeUndefined();
    const eco = applyPriorityParams(fill(), priorityDefaults("economy", 4));
    expect(eco.params.density).toBe(priorityDefaults("economy", 4).density);
    expect(eco.params.outline).toBe(false);
  });

  it("never overrides an explicit density (the sketch look's 0.8 stays)", () => {
    const o = fill({ fillStyle: "sketch", density: 0.8 });
    const out = applyPriorityParams(o, priorityDefaults("coverage", 4));
    expect(out.params.density).toBe(0.8);
  });

  it("leaves line-art stroke networks and non-fills alone", () => {
    const stroke = fill({ fillStyle: "satin", lineArt: true });
    expect(applyPriorityParams(stroke, priorityDefaults("economy", 4))).toBe(stroke);
    const running: EmbObject = { ...fill(), type: "running" };
    expect(applyPriorityParams(running, priorityDefaults("coverage", 4))).toBe(running);
  });

  it("does not mutate its input", () => {
    const o = fill();
    applyPriorityParams(o, priorityDefaults("economy", 4));
    expect(o.params).toEqual({});
  });
});
