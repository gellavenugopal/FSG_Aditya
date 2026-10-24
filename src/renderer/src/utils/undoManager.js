/**
 * Lightweight global undo/redo for categorisation changes.
 * Keeps the last `MAX` actions on each stack. Each action is a composite
 * containing per-row before/after snapshots (so a bulk rectification undoes
 * as a single Ctrl+Z).
 */
const MAX = 3
let undoStack = []  // newest at the end
let redoStack = []  // newest at the end
const listeners = new Set()

function notify() { listeners.forEach(fn => { try { fn() } catch {} }) }

export function subscribeUndo(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function pushAction(action) {
  // action: { label, changes: [{ id, before, after }] }
  if (!action || !action.changes || action.changes.length === 0) return
  undoStack.push(action)
  if (undoStack.length > MAX) undoStack = undoStack.slice(undoStack.length - MAX)
  redoStack = []  // any new action invalidates the redo stack
  notify()
}

export function canUndo() { return undoStack.length > 0 }
export function canRedo() { return redoStack.length > 0 }

export function peekUndoLabel() { return undoStack.length ? undoStack[undoStack.length - 1].label : '' }
export function peekRedoLabel() { return redoStack.length ? redoStack[redoStack.length - 1].label : '' }

async function applySnapshot(id, snap) {
  if (!snap) return
  await window.api?.overrideRow(id, {
    mapping1_resultant: snap.mapping1_resultant ?? null,
    mapping2_resultant: snap.mapping2_resultant ?? null,
    mapping3_resultant: snap.mapping3_resultant ?? null,
    level_format_id: snap.level_format_id ?? null,
    level4_value: snap.level4_value ?? null,
    level5_value: snap.level5_value ?? null,
    level6_value: snap.level6_value ?? null,
    level7_value: snap.level7_value ?? null,
    override_note: snap.override_note ?? null,
  })
}

export async function undo() {
  if (undoStack.length === 0) return null
  const action = undoStack.pop()
  for (const ch of action.changes) await applySnapshot(ch.id, ch.before)
  redoStack.push(action)
  if (redoStack.length > MAX) redoStack = redoStack.slice(redoStack.length - MAX)
  notify()
  return action
}

export async function redo() {
  if (redoStack.length === 0) return null
  const action = redoStack.pop()
  for (const ch of action.changes) await applySnapshot(ch.id, ch.after)
  undoStack.push(action)
  if (undoStack.length > MAX) undoStack = undoStack.slice(undoStack.length - MAX)
  notify()
  return action
}

/**
 * Snapshot only the mapping fields we modify (so undo/redo restores them).
 */
export function snapshotMapping(row) {
  return {
    mapping1_resultant: row.mapping1_resultant ?? null,
    mapping2_resultant: row.mapping2_resultant ?? null,
    mapping3_resultant: row.mapping3_resultant ?? null,
    level_format_id: row.level_format_id ?? null,
    level4_value: row.level4_value ?? null,
    level5_value: row.level5_value ?? null,
    level6_value: row.level6_value ?? null,
    level7_value: row.level7_value ?? null,
    override_note: row.override_note ?? null,
  }
}
