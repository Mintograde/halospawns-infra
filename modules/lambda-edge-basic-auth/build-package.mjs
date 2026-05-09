import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const buildRoot = path.resolve(moduleDir, ".build");
const buildDir = path.resolve(process.env.LAMBDA_EDGE_AUTH_BUILD_DIR || "");
const relativeBuildPath = path.relative(buildRoot, buildDir);

if (!relativeBuildPath || relativeBuildPath.startsWith("..") || path.isAbsolute(relativeBuildPath)) {
  throw new Error(`Refusing to write outside ${buildRoot}`);
}

const indexJsBase64 = process.env.LAMBDA_EDGE_AUTH_INDEX_JS_B64;
if (!indexJsBase64) {
  throw new Error("LAMBDA_EDGE_AUTH_INDEX_JS_B64 is required");
}

const dependencies = JSON.parse(process.env.LAMBDA_EDGE_AUTH_DEPENDENCIES || "{}");

rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });

writeFileSync(path.join(buildDir, "index.js"), Buffer.from(indexJsBase64, "base64").toString("utf8"));
writeFileSync(
  path.join(buildDir, "package.json"),
  JSON.stringify({
    private: true,
    type: "commonjs",
    dependencies
  }, null, 2)
);

const nodeBinDir = path.dirname(process.execPath);
const npmCli = path.join(nodeBinDir, "node_modules", "npm", "bin", "npm-cli.js");

if (!existsSync(npmCli)) {
  throw new Error(`Could not find npm CLI next to Node.js: ${npmCli}`);
}

const install = spawnSync(process.execPath, [
  npmCli,
  "install",
  "--omit=dev",
  "--no-audit",
  "--no-fund",
  "--package-lock=false",
  "--cache",
  path.join(buildRoot, ".npm-cache")
], {
  cwd: buildDir,
  stdio: "inherit"
});

if (install.status !== 0) {
  const reason = install.error ? `: ${install.error.message}` : install.signal ? ` via signal ${install.signal}` : "";
  throw new Error(`npm install failed with exit code ${install.status}${reason}`);
}
