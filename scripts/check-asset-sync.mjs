#!/usr/bin/env node
/**
 * Drift guard for the duplicated setup scripts.
 *
 * The customer-facing installer scripts live in TWO places:
 *   - src/assets/setup-{macos.sh,windows.ps1}            (canonical — served live by the Worker)
 *   - ../shop-os-installer/scripts/setup-{macos.sh,windows.ps1}  (repo reference copy)
 *
 * They must stay byte-identical. This script fails (exit 1) if they have drifted,
 * so `npm run deploy` can't ship a Worker whose live scripts disagree with the
 * installer repo. If the sibling installer repo isn't present (e.g. a CI box that
 * only checked out the license server), it warns and passes — there's nothing to
 * compare against.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, "..", "src", "assets");
const installerDir = join(here, "..", "..", "shop-os-installer", "scripts");

const PAIRS = ["setup-macos.sh", "setup-windows.ps1"];

if (!existsSync(installerDir)) {
  console.warn(
    `! Sibling installer repo not found at ${installerDir} — skipping asset-sync check.`,
  );
  process.exit(0);
}

const drifted = [];
for (const name of PAIRS) {
  const a = join(assetsDir, name);
  const b = join(installerDir, name);
  if (!existsSync(a)) {
    drifted.push(`${name}: missing canonical copy at ${a}`);
    continue;
  }
  if (!existsSync(b)) {
    drifted.push(`${name}: missing installer-repo copy at ${b}`);
    continue;
  }
  if (readFileSync(a, "utf8") !== readFileSync(b, "utf8")) {
    drifted.push(`${name}: src/assets and shop-os-installer/scripts differ`);
  }
}

if (drifted.length > 0) {
  console.error("✗ Setup scripts have drifted between the two repos:\n");
  for (const d of drifted) console.error("  - " + d);
  console.error(
    "\n  Sync them before deploying (canonical = license-server/src/assets/).\n" +
      "  Quick diff:\n" +
      `    diff "${assetsDir}/setup-macos.sh"   "${installerDir}/setup-macos.sh"\n` +
      `    diff "${assetsDir}/setup-windows.ps1" "${installerDir}/setup-windows.ps1"`,
  );
  process.exit(1);
}

console.log("✓ Setup scripts are in sync across both repos.");
