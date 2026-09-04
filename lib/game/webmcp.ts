import type { GameState, Scenery, Topology } from './core';
type Tool = {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  execute: (input: unknown) => unknown;
};
type Context = {
  registerTool: (
    tool: Tool,
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};
export function registerGameTools(
  context: Context | undefined,
  read: () => GameState & { scenery: Scenery },
  configure: (topology: Topology, scenery: Scenery) => void,
) {
  const lifecycle = new AbortController();
  if (!context?.registerTool) return () => lifecycle.abort();
  const tools: Tool[] = [
    {
      name: 'read_flight_state',
      description: 'Read RoadTilt status, speed, distance, road and scenery.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: () => ({ ...read() }),
    },
    {
      name: 'configure_flight',
      description:
        'Choose a road and scenery. Resets the current run to its start screen; does not start flying.',
      inputSchema: {
        type: 'object',
        properties: {
          topology: { type: 'string', enum: ['flow', 'serpentine', 'alpine'] },
          scenery: { type: 'string', enum: ['coast', 'desert', 'night'] },
        },
        required: ['topology', 'scenery'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input) => {
        if (!input || typeof input !== 'object')
          throw new Error('Expected road and scenery.');
        const data = input as Record<string, unknown>;
        if (
          Object.keys(data).some(
            (key) => !['topology', 'scenery'].includes(key),
          ) ||
          !['flow', 'serpentine', 'alpine'].includes(String(data.topology)) ||
          !['coast', 'desert', 'night'].includes(String(data.scenery))
        )
          throw new Error('Invalid road or scenery.');
        configure(data.topology as Topology, data.scenery as Scenery);
        return { ...read() };
      },
    },
  ];
  for (const tool of tools) {
    try {
      void Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {
      /* Optional integration must not interrupt a run. */
    }
  }
  return () => lifecycle.abort();
}
export type { Context as GameModelContext };
