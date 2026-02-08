/** In-process mutex for agents.yaml + .sources.json read-modify-write cycles. */
let configLock = Promise.resolve();

export function withConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = configLock;
  let release: () => void;
  configLock = new Promise<void>((r) => { release = r; });
  return prev.then(fn).finally(() => release!());
}
