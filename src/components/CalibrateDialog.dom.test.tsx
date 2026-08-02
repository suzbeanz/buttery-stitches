// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import CalibrateDialog from "./CalibrateDialog";
import { useProjectStore } from "../store/projectStore";
import { resetStores } from "../test/setup";
import { createEmptyProject } from "../lib/project";

// The real fit relaxes a several-thousand-node spring network ~130 times
// (seconds) — the wizard's flow is what this test covers, so mock the math.
vi.mock("../lib/calibration", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    fitCalibration: vi.fn(() => ({
      pullStrain: 0.09,
      backing: 0.05,
      residualMm: 0.08,
      rawErrorMm: 0.42,
    })),
  };
});

describe("CalibrateDialog", () => {
  beforeEach(() => {
    cleanup();
    resetStores(createEmptyProject());
  });

  it("walks sew → measure → fit and applies the calibration to the project", async () => {
    const onClose = vi.fn();
    render(<CalibrateDialog onClose={onClose} />);

    // Step 1 → 2
    fireEvent.click(screen.getByText(/I sewed it — measure/i));
    // Enter one measurement (satin 3mm came out narrow).
    const input = screen.getByLabelText(/Satin 3 mm column width/i);
    fireEvent.change(input, { target: { value: "2.6" } });

    fireEvent.click(screen.getByText(/^Fit calibration$/i));
    await waitFor(() => screen.getByText(/Apply to this design/i), { timeout: 3000 });

    // The honest before/after story is shown.
    expect(screen.getByText(/0\.42 mm/)).toBeTruthy();
    expect(screen.getByText(/0\.08 mm/)).toBeTruthy();

    fireEvent.click(screen.getByText(/Apply to this design/i));
    expect(useProjectStore.getState().project.calibration).toEqual({
      pullStrain: 0.09,
      backing: 0.05,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("fit stays disabled until a measurement is entered", () => {
    render(<CalibrateDialog onClose={() => {}} />);
    fireEvent.click(screen.getByText(/I sewed it — measure/i));
    const fitBtn = screen.getByText(/^Fit calibration$/i).closest("button")!;
    expect(fitBtn.disabled).toBe(true);
  });
});
