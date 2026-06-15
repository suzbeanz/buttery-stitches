// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import SimulatorBar from "./SimulatorBar";
import { useEditorStore } from "../store/editorStore";
import { resetStores } from "../test/setup";

/**
 * Synthetic playback journey: a user switches to Stitch view and presses Play.
 * The whole point of the simulator is that it animates from nothing to the full
 * design — an empty frame that never advances is the bug we're guarding against.
 * We drive requestAnimationFrame by hand so the loop is deterministic.
 */
describe("SimulatorBar playback", () => {
  let frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    cleanup();
    resetStores();
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Run every pending animation frame with timestamp `t` (ms). */
  function flush(t: number) {
    const pending = frames;
    frames = [];
    act(() => {
      pending.forEach((cb) => cb(t));
    });
  }

  it("Play advances the cursor from 0 toward the total", () => {
    useEditorStore.setState({ viewMode: "stitch", simTotal: 1000, simIndex: 1000, simSpeed: 400 });
    render(<SimulatorBar />);

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    // Pressing play from the end rewinds to 0 and starts playing.
    expect(useEditorStore.getState().simIndex).toBe(0);
    expect(useEditorStore.getState().simPlaying).toBe(true);

    // Two frames ~0.5 s apart at 400 stitches/s should reveal ~200 stitches.
    const t0 = performance.now();
    flush(t0 + 250);
    flush(t0 + 500);
    const idx = useEditorStore.getState().simIndex;
    expect(idx).toBeGreaterThan(0);
    expect(idx).toBeLessThan(1000);
  });

  it("playback stops exactly at the total and can replay", () => {
    useEditorStore.setState({ viewMode: "stitch", simTotal: 100, simIndex: 0, simSpeed: 400 });
    render(<SimulatorBar />);

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    // One big frame (1 s × 400/s = 400) overshoots 100 → clamp + stop.
    const t0 = performance.now();
    flush(t0 + 1000);
    expect(useEditorStore.getState().simIndex).toBe(100);
    expect(useEditorStore.getState().simPlaying).toBe(false);
  });

  it("Play is disabled with nothing to sew", () => {
    useEditorStore.setState({ viewMode: "stitch", simTotal: 0, simIndex: 0 });
    render(<SimulatorBar />);
    const play = screen.getByRole("button", { name: "Play" }) as HTMLButtonElement;
    expect(play.disabled).toBe(true);
  });
});
