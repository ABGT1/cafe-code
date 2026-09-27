import { EDITORS, EditorId, LocalApi } from "@cafecode/contracts";
import {
  getLocalStorageItemWithLegacy,
  setLocalStorageItemWithLegacy,
  useLocalStorage,
} from "./hooks/useLocalStorage";
import { useMemo } from "react";
import { splitPathAndPosition } from "./path-links";

const LAST_EDITOR_KEY = "cafe-code:last-editor";
const LEGACY_LAST_EDITOR_KEY = "cafecode:last-editor";

export function usePreferredEditor(availableEditors: ReadonlyArray<EditorId>) {
  const [lastEditor, setLastEditor] = useLocalStorage(LAST_EDITOR_KEY, null, EditorId, [
    LEGACY_LAST_EDITOR_KEY,
  ]);

  const effectiveEditor = useMemo(() => {
    if (lastEditor && availableEditors.includes(lastEditor)) return lastEditor;
    return EDITORS.find((editor) => availableEditors.includes(editor.id))?.id ?? null;
  }, [lastEditor, availableEditors]);

  return [effectiveEditor, setLastEditor] as const;
}

export function resolveAndPersistPreferredEditor(
  availableEditors: readonly EditorId[],
): EditorId | null {
  const availableEditorIds = new Set(availableEditors);
  const stored = getLocalStorageItemWithLegacy(LAST_EDITOR_KEY, [LEGACY_LAST_EDITOR_KEY], EditorId);
  if (stored && availableEditorIds.has(stored)) return stored;
  const editor = EDITORS.find((editor) => availableEditorIds.has(editor.id))?.id ?? null;
  if (editor)
    setLocalStorageItemWithLegacy(LAST_EDITOR_KEY, [LEGACY_LAST_EDITOR_KEY], editor, EditorId);
  return editor ?? null;
}

export async function openInPreferredEditor(api: LocalApi, targetPath: string): Promise<EditorId> {
  const { availableEditors, clientSettings } = await api.server.getConfig();
  if (clientSettings.defaultEditor === "system-default") {
    await api.shell.openPath(splitPathAndPosition(targetPath).path);
    return "file-manager";
  }

  if (availableEditors.includes(clientSettings.defaultEditor)) {
    await api.shell.openInEditor(targetPath, clientSettings.defaultEditor);
    return clientSettings.defaultEditor;
  }

  const editor = resolveAndPersistPreferredEditor(availableEditors);
  if (!editor) throw new Error("No available editors found.");
  await api.shell.openInEditor(targetPath, editor);
  return editor;
}
