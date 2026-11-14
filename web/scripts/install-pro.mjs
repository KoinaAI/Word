import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const target = join(root, "node_modules/@heroui-pro/react");
const version = JSON.parse(readFileSync(join(root, "package.json")))
  .dependencies["@heroui-pro/react"];
const cache =
  process.env.HEROUI_PRO_DIR || join(homedir(), ".heroui/cache/react", version);
if (!existsSync(join(target, "dist/index.js"))) {
  if (existsSync(join(cache, "dist/index.js"))) {
    const cached = JSON.parse(readFileSync(join(cache, "package.json")));
    if (cached.version !== version)
      throw new Error(`HeroUI Pro version must be ${version}`);
    cpSync(cache, target, { recursive: true });
    rmSync(join(target, "dist/postinstall"), { recursive: true, force: true });
    console.log(`Restored licensed HeroUI Pro ${version} from local cache.`);
  } else if (process.env.HEROUI_AUTH_TOKEN) {
    const result = spawnSync(
      process.execPath,
      [join(target, "dist/postinstall/index.js")],
      { stdio: "inherit" },
    );
    if (result.status) process.exit(result.status);
  }
}
if (!existsSync(join(target, "dist/index.js"))) {
  console.error(
    "HeroUI Pro artifacts are required. Run npx heroui-pro login and npx heroui-pro install react, or provide HEROUI_AUTH_TOKEN / HEROUI_PRO_DIR. See README.md.",
  );
  process.exit(1);
}
