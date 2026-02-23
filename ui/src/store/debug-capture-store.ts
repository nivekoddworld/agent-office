import { useSyncExternalStore } from "react";
import type { FeedEvent } from "./event-store.js";
import {
  toDebugRow,
  matchesFilter,
  DEFAULT_FILTER,
  type DebugFilter,
  type DebugEventRow,
} from "../components/slack/debug-helpers.js";

const BUFFER_LIMIT = 250;

export interface CaptureState {
  draftFilter: DebugFilter;
  activeFilter: DebugFilter;
  isCapturing: boolean;
  rows: DebugEventRow[];
  droppedCount: number;
}

export function createDebugCaptureStore() {
  let state: CaptureState = {
    draftFilter: { ...DEFAULT_FILTER },
    activeFilter: { ...DEFAULT_FILTER },
    isCapturing: false,
    rows: [],
    droppedCount: 0,
  };
  let nextId = 1;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const fn of listeners) fn();
  };

  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const getSnapshot = () => state;

  const setDraftFilter = (patch: Partial<DebugFilter>) => {
    state = { ...state, draftFilter: { ...state.draftFilter, ...patch } };
    notify();
  };

  const startCapture = () => {
    state = {
      ...state,
      isCapturing: true,
      activeFilter: { ...state.draftFilter },
      rows: [],
      droppedCount: 0,
    };
    notify();
  };

  const stopCapture = () => {
    state = { ...state, isCapturing: false };
    notify();
  };

  const clearBuffer = () => {
    state = { ...state, rows: [], droppedCount: 0 };
    notify();
  };

  const ingestEvent = (type: string, data: unknown) => {
    if (!state.isCapturing) return;
    const event: FeedEvent = {
      id: nextId++,
      type,
      data,
      timestamp: Date.now(),
    };
    const row = toDebugRow(event);
    if (!row) return;
    if (!matchesFilter(row, state.activeFilter)) return;
    if (state.rows.length >= BUFFER_LIMIT) {
      state = { ...state, droppedCount: state.droppedCount + 1 };
      notify();
      return;
    }
    state = { ...state, rows: [...state.rows, row] };
    notify();
  };

  return {
    subscribe,
    getSnapshot,
    setDraftFilter,
    startCapture,
    stopCapture,
    clearBuffer,
    ingestEvent,
  };
}

export const debugCaptureStore = createDebugCaptureStore();

export function useDebugCaptureStore(): CaptureState {
  return useSyncExternalStore(
    debugCaptureStore.subscribe,
    debugCaptureStore.getSnapshot,
  );
}
