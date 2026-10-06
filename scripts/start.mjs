import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import electron from "electron";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const build = spawn(
  process.execPath,
  [resolve(root, "node_modules/vite/bin/vite.js"), "build"],
  { cwd: root, stdio: "inherit", windowsHide: true },
);
const code = await new Promise((resolve, reject) => {
  build.on("exit", resolve);
  build.on("error", reject);
});
if (code !== 0) process.exit(Number(code) || 1);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.XM_DEV_URL;
const child = spawn(electron, [root], {
  cwd: root,
  env,
  stdio: "inherit",
  windowsHide: false,
});
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code || 0));
