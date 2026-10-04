/**
 * What a build's config/defaults.json may set for the npm and desktop
 * launchers, and the checks on those values.
 *
 * Dependency-free (Node built-ins only): the packaged desktop app strips
 * node_modules, so a bare import here would fail only in the installed app.
 */

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
