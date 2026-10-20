/**
 * Runs the tasks one after another and returns their results in order, like `Promise.all` over
 * thunks. Queries of one request share one connection inside a transaction, and node-pg must not
 * be sent a query while another runs on the same client, so the catalog never runs them at once.
 */
export async function inSequence<T extends readonly unknown[]>(tasks: {
  readonly [K in keyof T]: () => Promise<T[K]>;
}): Promise<T> {
  const results: unknown[] = [];
  for (const task of tasks as readonly (() => Promise<unknown>)[]) results.push(await task());
  return results as unknown as T;
}
