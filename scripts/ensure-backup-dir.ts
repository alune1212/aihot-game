// Linux Docker creates a missing bind-mount directory as root:root mode 0755. The worker runs as
// node and then cannot pg_dump into it. Run this as root before the worker. A directory node can
// already write — the usual macOS checkout — is left unchanged.
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";

const dir = process.env.DB_BACKUP_LOCAL_DIR?.trim() || "/var/backups/aihot";
mkdirSync(dir, { recursive: true });

function id(flag: "-u" | "-g"): number {
  const result = spawnSync("id", [flag, "node"], { encoding: "utf8" });
  const value = Number(result.stdout.trim());
  if (result.status !== 0 || !Number.isInteger(value)) {
    console.error(`local backup: cannot resolve the node user (${result.stderr.trim()})`);
    process.exit(1);
  }
  return value;
}

const uid = id("-u");
const gid = id("-g");
const probe = `${dir}/.write-probe`;

function writableByNode(): boolean {
  const result = spawnSync(process.execPath, ["--input-type=commonjs", "-e", `
    const fs = require("node:fs");
    const file = ${JSON.stringify(probe)};
    fs.writeFileSync(file, "");
    fs.unlinkSync(file);
  `], { uid, gid });
  return result.status === 0;
}

if (writableByNode()) process.exit(0);

if (typeof process.getuid === "function" && process.getuid() !== 0) {
  console.error(`local backup directory is not writable by node (uid ${uid}): ${dir}. mkdir -p backups && sudo chown ${uid}:${gid} backups`);
  process.exit(1);
}

const chown = spawnSync("chown", [`${uid}:${gid}`, dir], { encoding: "utf8" });
if (chown.status !== 0) {
  console.error(`local backup: chown ${uid}:${gid} ${dir} failed: ${chown.stderr.trim()}`);
  process.exit(1);
}
if ((statSync(dir).mode & 0o200) === 0) spawnSync("chmod", ["u+rwx", dir]);
if (!writableByNode()) {
  console.error(`local backup directory is still not writable by node (uid ${uid}): ${dir}. mkdir -p backups && sudo chown ${uid}:${gid} backups`);
  process.exit(1);
}
