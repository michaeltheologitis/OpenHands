/**
 * What a build's config/defaults.json may set for the npm and desktop
 * launchers, and the checks on those values.
 *
 * The keys are fallbacks for environment variables of the same meaning.
 * applyLauncherDefaults() adds them to the environment only where the variable
 * is unset; called once at a launcher's entry, it leaves every other function
 * reading only the env it is given. So environment variables still win,
 * variable by variable, and the children a launcher starts inherit the same
 * values.
 *
 *   sources.agentServerGitRepo -> OH_AGENT_SERVER_GIT_REPO
 *   sources.agentServerGitRef  -> OH_AGENT_SERVER_GIT_REF, only when the
 *                                 environment names no agent-server source
 *   paths.stateDir             -> OH_CANVAS_SAFE_STATE_DIR, and the two key
 *                                 files inside it (OH_SECRET_KEY_PATH,
 *                                 OH_SESSION_API_KEY_PATH)
 *
 * `setup` names a command to run as the user before the stack starts and once
 * the agent-server is ready; readSetupConfig validates it.
 *
 * Dependency-free (Node built-ins only): the packaged desktop app strips
 * node_modules, so a bare import here would fail only in the installed app.
 */

import { homedir } from "node:os";
import path from "node:path";

const DEFAULTS_FILE = "config/defaults.json";

// Any of these in the environment names the agent-server's source, so a git
// ref from defaults.json must not outrank it.
const AGENT_SERVER_SOURCE_VARIABLES = [
  "OH_AGENT_SERVER_LOCAL_PATH",
  "OH_AGENT_SERVER_GIT_REF",
  "OH_AGENT_SERVER_VERSION",
];

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
 * Add launcherDefaultsEnv(env, defaults) to `env` in place.
 * @param {Record<string, string | undefined>} env
 * @param {Record<string, any>} defaults  the parsed config/defaults.json
 * @returns {string[]} the names of the variables it filled, sorted
 */
export function applyLauncherDefaults(env, defaults) {
  const filled = launcherDefaultsEnv(env, defaults);
  Object.assign(env, filled);
  return Object.keys(filled).sort();
}

/**
 * `value` with a leading "~" or "~/" expanded to `home`; throws, naming the
 * value `name`, unless that is an absolute path.
 */
function expandHomePath(value, name, home) {
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
 * The value is a plain repository URL: uv's `git+` scheme is not part of it.
 *
 * @param {unknown} value
 * @param {string} name  e.g. "OH_AGENT_SERVER_GIT_REPO" or "sources.agentServerGitRepo in config/defaults.json"
 * @returns {string} the value
 * @throws {Error} `${name} must be an https or ssh git URL, got: ${value}`
 */
export function validateGitRepoUrl(value, name) {
  const url =
    typeof value === "string" && !/\s/.test(value) ? URL.parse(value) : null;
  if ((url?.protocol === "https:" || url?.protocol === "ssh:") && url.host) {
    return value;
  }
  throw new Error(`${name} must be an https or ssh git URL, got: ${value}`);
}

/** The phases a setup command can run in, in launch order. */
const SETUP_PHASES = Object.freeze(["before-start", "after-ready"]);

/**
 * @typedef {object} SetupConfig
 * @property {string[]} command  argv; command[0] is resolved on PATH; run without a shell.
 * @property {("before-start" | "after-ready")[]} phases  non-empty, no duplicates, in SETUP_PHASES order.
 */

/**
 * The setup command of `defaults`, validated, or null when setup.command is
 * null or absent. setup.phases defaults to both phases.
 * @param {Record<string, any>} defaults
 * @returns {SetupConfig | null}
 * @throws {Error} naming setup.command or setup.phases when either is malformed
 */
export function readSetupConfig(defaults) {
  const command = defaults.setup?.command ?? null;
  const phases = defaults.setup?.phases ?? SETUP_PHASES;

  if (
    !Array.isArray(phases) ||
    phases.length === 0 ||
    new Set(phases).size !== phases.length ||
    !phases.every((phase) => SETUP_PHASES.includes(phase))
  ) {
    throw new Error(
      `setup.phases in ${DEFAULTS_FILE} may list only "before-start" and "after-ready", got: ${JSON.stringify(phases)}`,
    );
  }
  if (command === null) return null;
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    !command.every((arg) => typeof arg === "string" && arg !== "")
  ) {
    throw new Error(
      `setup.command in ${DEFAULTS_FILE} must be a non-empty array of non-empty strings, got: ${JSON.stringify(command)}`,
    );
  }
  return {
    command: [...command],
    phases: SETUP_PHASES.filter((phase) => phases.includes(phase)),
  };
}
