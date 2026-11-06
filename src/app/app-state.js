// @ts-check
/**
 * PART 5. 화면 상태 관리
 * 화면끼리 변수를 직접 주고받지 않고 이 store 하나로 상태를 공유한다.
 */

/**
 * @template T
 * @param {T} initial
 */
export function createStore(initial) {
  let state = initial;
  /** @type {Set<(s: T) => void>} */
  const listeners = new Set();

  return {
    getState: () => state,
    /** @param {Partial<T>} patch */
    setState(patch) {
      state = { ...state, ...patch };
      listeners.forEach((fn) => fn(state));
    },
    /** @param {(s: T) => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const appState = createStore({
  /** @type {'idle' | 'running' | 'done' | 'error'} */
  status: 'idle',
  /** @type {any} */
  result: null,
  /** @type {{ step?: string, code: string, message: string } | null} */
  error: null,
});
