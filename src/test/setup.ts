import { useProjectStore } from "../store/projectStore";
import { useEditorStore } from "../store/editorStore";
import { createEmptyProject } from "../lib/project";
import type { Project } from "../types/project";

/** Reset both stores to a clean slate between component tests. */
export function resetStores(project?: Project) {
  useProjectStore.setState({
    project: project ?? createEmptyProject(),
    selectedIds: [],
  });
  useProjectStore.temporal.getState().clear();
  useEditorStore.setState({
    tool: "select",
    draft: [],
    cursorMm: null,
    activeColorId: null,
    rulerUnit: "mm",
    viewMode: "edit",
    simTotal: 0,
    simIndex: 0,
    simPlaying: false,
    simSpeed: 400,
  });
}
