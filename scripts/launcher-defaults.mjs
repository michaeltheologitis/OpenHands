/**
 * What a build's config/defaults.json may set for the npm and desktop
 * launchers, and the checks on those values.
 *
 * The keys are fallbacks for environment variables of the same meaning. Each
 * launcher's main() calls applyLauncherDefaults() once, first, which adds them
 * to process.env only where the variable is unset; every other function keeps
 * reading only the env it is given. So environment variables still win,
 * variable by variable, and the children the launchers start inherit the same
 * values.
 *
 *   sources.agentServerGitRepo -> OH_AGENT_SERVER_GIT_REPO
 *   sources.agentServerGitRef  -> OH_AGENT_SERVER_GIT_REF, only when the
 *                                 environment names no agent-server source
 *   paths.stateDir             -> OH_CANVAS_SAFE_STATE_DIR, and the two key
 *                                 files inside it (OH_SECRET_KEY_PATH,
 *                                 OH_SESSION_API_KEY_PATH)
 *
 * Dependency-free (Node built-ins only): the packaged desktop app strips
 * node_modules, so a bare import here would fail only in the installed app.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULTS_FILE = "config/defaults.json";

// Any of these in the environment names the agent-server's source, so a git
// ref from defaults.json must not outrank it.
const AGENT_SERVER_SOURCE_VARIABLES = [
  "OH_AGENT_SERVER_LOCAL_PATH",
  "OH_AGENT_SERVER_GIT_REF",
  "OH_AGENT_SERVER_VERSION",
];

/**
 * Read config/defaults.json next to this module's scripts/ directory (the same
 * layout in the repo, the npm package and the packaged app).
 * @returns {Record<string, any>}
 */
export function loadSharedDefaults() {
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  return JSON.parse(
    readFileSync(path.join(scriptsDir, "..", DEFAULTS_FILE), "utf-8"),
  );
}

/**
 * Expand a leading "~" or "~/" to `home`; return the result if it is absolute.
 * @param {string} value
 * @param {string} name  how errors name the value, e.g. "paths.stateDir in config/defaults.json"
 * @param {string} [home] defaults to os.homedir()
 * @returns {string} an absolute path
 * @throws {Error} `${name} must be an absolute path or start with ~/, got: ${value}`
 */
export function expandHomePath(value, name, home = homedir()) {
  const expanded =
    value === "~"
      ? home
      : typeof value === "string" && value.startsWith("~/")
        ? path.join(home, value.slice(2))
        : value;
  if (typeof expanded !== "string" || !path.isAbsolute(expanded)) {
    throw new Error(
      `${name} must be an absolute path or start with ~/, got: ${value}`,
    );
  }
  return expanded;
}

/**
 * Accept an https:// or ssh:// URL with no whitespace; reject anything else (an
 * scp-style git@host:path, a bare owner/repo, a git+ prefix, http://, file://).
 * uv fetches a git requirement over `git+https` or `git+ssh`; the launcher adds
 * the `git+` prefix itself.
 *
 * @param {unknown} value
 * @param {string} name  e.g. "OH_AGENT_SERVER_GIT_REPO" or "sources.agentServerGitRepo in config/defaults.json"
 * @returns {string} the value
 * @throws {Error} `${name} must be an https or ssh git URL, got: ${value}`
 */
export function validateGitRepoUrl(value, name) {
  if (typeof value === "string" && !/\s/.test(value)) {
    try {
      const url = new URL(value);
      if ((url.protocol === "https:" || url.protocol === "ssh:") && url.host) {
        return value;
      }
    } catch {
      // Not a URL at all; reported below.
    }
  }
  throw new Error(`${name} must be an https or ssh git URL, got: ${value}`);
}

/**
 * The environment entries config/defaults.json supplies: only variables `env`
 * leaves unset; OH_AGENT_SERVER_GIT_REF only when env names no agent-server
 * source; the key paths only when the state directory comes from `defaults`.
 * Validates every launcher key of `defaults` whether or not env wins, so a
 * broken defaults.json fails every launch. Pure: reads nothing but its
 * arguments.
 * @param {Record<string, string | undefined>} env
 * @param {Record<string, any>} defaults  the parsed config/defaults.json
 * @param {string} [home] defaults to os.homedir()
 * @returns {Record<string, string>} the entries to add (empty for upstream's defaults)
 */
export function launcherDefaultsEnv(env, defaults, home = homedir()) {
  const repo = defaults.sources?.agentServerGitRepo ?? null;
  const ref = defaults.sources?.agentServerGitRef ?? null;
  const stateDirSetting = defaults.paths?.stateDir ?? null;

  if (repo !== null) {
    validateGitRepoUrl(repo, `sources.agentServerGitRepo in ${DEFAULTS_FILE}`);
  }
  if (ref !== null && (typeof ref !== "string" || ref.trim() === "")) {
    throw new Error(
      `sources.agentServerGitRef in ${DEFAULTS_FILE} must be a non-empty string, got: ${JSON.stringify(ref)}`,
    );
  }
  const stateDir =
    stateDirSetting === null
      ? null
      : expandHomePath(
          stateDirSetting,
          `paths.stateDir in ${DEFAULTS_FILE}`,
          home,
        );

  const filled = {};
  if (repo !== null && !env.OH_AGENT_SERVER_GIT_REPO) {
    filled.OH_AGENT_SERVER_GIT_REPO = repo;
  }
  if (
    ref !== null &&
    !AGENT_SERVER_SOURCE_VARIABLES.some((variable) => env[variable])
  ) {
    filled.OH_AGENT_SERVER_GIT_REF = ref;
  }
  if (stateDir !== null && !env.OH_CANVAS_SAFE_STATE_DIR) {
    // A build that names its own state directory is a different app: its
    // secrets must not be encrypted with another app's key file.
    filled.OH_CANVAS_SAFE_STATE_DIR = stateDir;
    if (!env.OH_SECRET_KEY_PATH) {
      filled.OH_SECRET_KEY_PATH = path.join(stateDir, "secret-key.txt");
    }
    if (!env.OH_SESSION_API_KEY_PATH) {
      filled.OH_SESSION_API_KEY_PATH = path.join(stateDir, "api-key.txt");
    }
  }
  return filled;
}

/**
 * Add launcherDefaultsEnv(env, defaults) to `env` in place. Each launcher's
 * main() calls this first.
 * @param {Record<string, string | undefined>} [env] defaults to process.env
 * @param {Record<string, any>} [defaults] defaults to loadSharedDefaults()
 * @returns {string[]} the names of the variables it filled, sorted
 */
export function applyLauncherDefaults(
  env = process.env,
  defaults = loadSharedDefaults(),
) {
  const filled = launcherDefaultsEnv(env, defaults);
  Object.assign(env, filled);
  return Object.keys(filled).sort();
}
