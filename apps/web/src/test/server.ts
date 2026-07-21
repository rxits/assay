import { setupServer } from "msw/node";

// Shared MSW server; per-test handlers are registered with server.use(...).
export const server = setupServer();
