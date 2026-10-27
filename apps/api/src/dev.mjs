// Local dev entry. Starts the API on port 8787 with a file database.

import { openStore } from "./index.ts";
import { startServer } from "./index.ts";

const store = openStore("./data/agent-wars.db");
const { port } = await startServer(store, 8787);
console.log(`agent-wars api on http://127.0.0.1:${port}`);
