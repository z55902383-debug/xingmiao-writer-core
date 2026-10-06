import { createServer } from "vite";
import { spawn } from "node:child_process";
import electron from "electron";
const server = await createServer();
await server.listen();
const env = { ...process.env, XM_DEV_URL: server.resolvedUrls.local[0] };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], {
  env,
  stdio: "inherit",
  windowsHide: false,
});
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  child.kill();
  await server.close();
  process.exit(code);
}
child.on("exit", (code) => close(code || 0));
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
