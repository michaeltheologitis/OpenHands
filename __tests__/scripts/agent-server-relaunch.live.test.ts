// @vitest-environment node
// On-demand live test, skipped unless OH_AGENT_SERVER_LIVE=1 (Linux only):
// real uvx, GitHub and PyPI. .github/workflows/launcher-live.yml runs it.
//
// The agent-server installed from a pinned commit starts again with the
// network cut: the launcher installs a full commit SHA without --reinstall,
// so a relaunch runs uv's cached build. The cut is a network namespace with
// only a loopback, entered with `unshare`.
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import {
  buildAgentServerCommand,
  buildAgentServerEnv,
  buildSafeDevConfig,
  findFreePort,
} from "../../scripts/dev-safe.mjs";

const LIVE =
  process.env.OH_AGENT_SERVER_LIVE === "1" && process.platform === "linux";

// v1.50.1 of upstream's SDK, so the test is generic. A fork points it at its
// own pinned commit with OH_AGENT_SERVER_GIT_REPO and OH_AGENT_SERVER_GIT_REF.
const UPSTREAM_V1_50_1_COMMIT = "1e1390acc8788346ba4804c34323284009bf3f5e";

const FIRST_INSTALL_TIMEOUT_MS = 10 * 60_000;
const RELAUNCH_TIMEOUT_MS = 3 * 60_000;

// Starts the agent-server command and polls /server_info from wherever it
// runs (inside the namespace for the relaunch). Reports, as one JSON line,
// whether the server answered, whether the internet was reachable from here,
// and its last output lines.
const PROBE_SOURCE = `
import { spawn } from "node:child_process";

const { command, args, env, url, timeoutMs } = JSON.parse(process.env.PROBE);
const internetReachable = await fetch("https://pypi.org/simple/", {
  signal: AbortSignal.timeout(5_000),
}).then(() => true, () => false);

const child = spawn(command, args, {
  env: { ...process.env, ...env },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
const tail = [];
const keep = (data) => {
  tail.push(...data.toString().split("\\n").filter(Boolean));
  tail.splice(0, tail.length - 40);
};
child.stdout.on("data", keep);
child.stderr.on("data", keep);
let exit = null;
child.on("close", (code, signal) => {
  exit = { code, signal };
});

const deadline = Date.now() + timeoutMs;
let ready = false;
while (!ready && !exit && Date.now() < deadline) {
  ready = await fetch(url, { signal: AbortSignal.timeout(2_000) }).then(
    (response) => response.ok,
    () => false,
  );
  if (!ready) await new Promise((resolve) => setTimeout(resolve, 500));
}
try {
  process.kill(-child.pid, "SIGTERM");
} catch {}
await new Promise((resolve) => setTimeout(resolve, 2_000));
try {
  process.kill(-child.pid, "SIGKILL");
} catch {}
console.log(JSON.stringify({ ready, internetReachable, exit, tail }));
`;

type ProbeResult = {
  ready: boolean;
  internetReachable: boolean;
  exit: { code: number | null; signal: string | null } | null;
  tail: string[];
};

// Root needs no user namespace; anyone else maps themselves to root in one,
// which is what lets the probe bring the namespace's loopback up.
const unshareArgs = () =>
  process.getuid?.() === 0 ? ["-n"] : ["--map-root-user", "-n"];

function cutNetworkPrefix() {
  return [
    "unshare",
    ...unshareArgs(),
    "sh",
    "-c",
    'ip link set lo up && exec "$@"',
    "sh",
  ];
}

async function runProbe(
  probeFile: string,
  probe: Record<string, unknown>,
  { networkCut }: { networkCut: boolean },
): Promise<ProbeResult> {
  const argv = [
    ...(networkCut ? cutNetworkPrefix() : []),
    process.execPath,
    probeFile,
  ];
  const child = spawn(argv[0], argv.slice(1), {
    env: { ...process.env, PROBE: JSON.stringify(probe) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  await once(child, "close");
  const lastLine = stdout.trim().split("\n").at(-1) ?? "";
  return JSON.parse(lastLine) as ProbeResult;
}

describe.skipIf(!LIVE)("agent-server relaunch (live)", () => {
  it(
    "a pinned commit installs once and then starts with the network cut",
    async (ctx) => {
      const namespace = spawnSync(cutNetworkPrefix()[0], [
        ...cutNetworkPrefix().slice(1),
        "true",
      ]);
      ctx.skip(
        namespace.status !== 0,
        `cannot create a network namespace with a loopback here: ${namespace.stderr?.toString().trim()}`,
      );

      const workDir = mkdtempSync(
        path.join(tmpdir(), "agent-server-relaunch-"),
      );
      try {
        const stateDir = path.join(workDir, "state", "agent-canvas");
        mkdirSync(path.join(stateDir, "workspaces"), { recursive: true });
        const probeFile = path.join(workDir, "probe.mjs");
        writeFileSync(probeFile, PROBE_SOURCE);

        const port = await findFreePort(0);
        const config = buildSafeDevConfig(workDir, {
          OH_CANVAS_SAFE_STATE_DIR: stateDir,
          OH_CANVAS_SAFE_BACKEND_PORT: String(port),
          OH_SECRET_KEY: "live-test-secret-key",
          LOCAL_BACKEND_API_KEY: "live-test-session-key",
        });
        const agentServer = buildAgentServerCommand({
          OH_AGENT_SERVER_GIT_REPO: process.env.OH_AGENT_SERVER_GIT_REPO,
          OH_AGENT_SERVER_GIT_REF:
            process.env.OH_AGENT_SERVER_GIT_REF || UPSTREAM_V1_50_1_COMMIT,
        });
        expect(agentServer.args).not.toContain("--reinstall");

        const probe = {
          command: agentServer.command,
          args: [
            ...agentServer.args,
            "--host",
            "127.0.0.1",
            "--port",
            String(port),
          ],
          env: {
            ...buildAgentServerEnv(config, { env: { DO_NOT_TRACK: "1" } }),
            UV_CACHE_DIR: path.join(workDir, "uv-cache"),
          },
          url: `${config.backendBaseUrl}/server_info`,
        };

        const firstLaunch = await runProbe(
          probeFile,
          { ...probe, timeoutMs: FIRST_INSTALL_TIMEOUT_MS },
          { networkCut: false },
        );
        expect(firstLaunch.ready, firstLaunch.tail.join("\n")).toBe(true);

        const relaunch = await runProbe(
          probeFile,
          { ...probe, timeoutMs: RELAUNCH_TIMEOUT_MS },
          { networkCut: true },
        );
        expect(relaunch.internetReachable).toBe(false);
        expect(relaunch.ready, relaunch.tail.join("\n")).toBe(true);
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
    20 * 60_000,
  );
});
