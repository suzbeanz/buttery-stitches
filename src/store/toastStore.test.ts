import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useToastStore, toast } from "./toastStore";

describe("toastStore", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("pushes a toast and auto-dismisses it", () => {
    toast("Saved", "success");
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]).toMatchObject({ message: "Saved", kind: "success" });
    vi.advanceTimersByTime(3300);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("keeps errors on screen longer than successes", () => {
    toast("ok", "success");
    toast("bad", "error");
    vi.advanceTimersByTime(3300); // success gone, error remains
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["bad"]);
    vi.advanceTimersByTime(3000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("can be dismissed manually", () => {
    toast("hi");
    const id = useToastStore.getState().toasts[0].id;
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
