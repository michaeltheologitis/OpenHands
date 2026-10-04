// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyLauncherDefaults,
  launcherDefaultsEnv,
} from "../../scripts/launcher-defaults.mjs";

const home = "/home/canvas-user";
const forkRepo = "https://github.com/example/software-agent-sdk";
const commitSha = "91430aa551ca3deb88989685656837929b3c246b";

/** A defaults.json shape with only the launcher keys a test sets. */
function defaultsWith({
  sources = {},
  paths = {},
}: {
  sources?: Record<string, unknown>;
  paths?: Record<string, unknown>;
} = {}) {
  return {
    sources: { agentServerGitRepo: null, agentServerGitRef: null, ...sources },
    paths: { stateSubdir: "agent-canvas", stateDir: null, ...paths },
  };
}

const forkSource = defaultsWith({
  sources: { agentServerGitRepo: forkRepo, agentServerGitRef: commitSha },
});

const stateDir = "/srv/example-app/agent-canvas";
const homeStateDir = path.join(home, ".example-app", "agent-canvas");
const withStateDir = (dir: string) =>
  defaultsWith({ paths: { stateDir: dir } });
const keyFilesIn = (dir: string) => ({
  OH_SECRET_KEY_PATH: path.join(dir, "secret-key.txt"),
  OH_SESSION_API_KEY_PATH: path.join(dir, "api-key.txt"),
});

describe("launcherDefaultsEnv", () => {
  it.each<
    [
      string,
      Record<string, string>,
      Record<string, unknown>,
      Record<string, string>,
    ]
  >([
    [
      "fills the agent-server's git repo and ref from defaults when the environment names no source",
      {},
      forkSource,
      {
        OH_AGENT_SERVER_GIT_REPO: forkRepo,
        OH_AGENT_SERVER_GIT_REF: commitSha,
      },
    ],
    [
      "an agent-server source in the environment wins over the defaults' ref (OH_AGENT_SERVER_LOCAL_PATH)",
      { OH_AGENT_SERVER_LOCAL_PATH: "/abs/path/to/software-agent-sdk" },
      forkSource,
      { OH_AGENT_SERVER_GIT_REPO: forkRepo },
    ],
    [
      "an agent-server source in the environment wins over the defaults' ref (OH_AGENT_SERVER_VERSION)",
      { OH_AGENT_SERVER_VERSION: "1.18.0" },
      forkSource,
      { OH_AGENT_SERVER_GIT_REPO: forkRepo },
    ],
    [
      "the defaults' repo still applies to a ref from the environment",
      { OH_AGENT_SERVER_GIT_REF: "feature-branch" },
      forkSource,
      { OH_AGENT_SERVER_GIT_REPO: forkRepo },
    ],
    [
      "the environment's repo wins over the defaults' repo",
      { OH_AGENT_SERVER_GIT_REPO: "https://github.com/someone/else" },
      forkSource,
      { OH_AGENT_SERVER_GIT_REF: commitSha },
    ],
    [
      "fills the state directory from defaults, expanding ~/ to the home directory",
      {},
      withStateDir("~/.example-app/agent-canvas"),
      { OH_CANVAS_SAFE_STATE_DIR: homeStateDir, ...keyFilesIn(homeStateDir) },
    ],
    [
      "fills the state directory from defaults, expanding a bare ~ to the home directory",
      {},
      withStateDir("~"),
      { OH_CANVAS_SAFE_STATE_DIR: home, ...keyFilesIn(home) },
    ],
    [
      "moves both key files into a state directory named by defaults",
      {},
      withStateDir(stateDir),
      { OH_CANVAS_SAFE_STATE_DIR: stateDir, ...keyFilesIn(stateDir) },
    ],
    [
      "leaves the key files alone when the environment names the state directory",
      { OH_CANVAS_SAFE_STATE_DIR: "/tmp/my-state" },
      withStateDir(stateDir),
      {},
    ],
    [
      "key file paths in the environment win over the defaults' state directory",
      {
        OH_SECRET_KEY_PATH: "/keys/secret.txt",
        OH_SESSION_API_KEY_PATH: "/keys/api.txt",
      },
      withStateDir(stateDir),
      { OH_CANVAS_SAFE_STATE_DIR: stateDir },
    ],
  ])("%s", (_name, env, defaults, expected) => {
    expect(launcherDefaultsEnv(env, defaults, home)).toEqual(expected);
  });

  it("returns nothing for defaults whose launcher keys are null", () => {
    // Upstream's config/defaults.json carries every launcher key as null.
    expect(launcherDefaultsEnv({}, defaultsWith(), home)).toEqual({});
    expect(launcherDefaultsEnv({}, {}, home)).toEqual({});
  });

  // A broken defaults.json fails every launch, not only the ones that use it.
  const environmentWins = {
    OH_AGENT_SERVER_GIT_REPO: forkRepo,
    OH_AGENT_SERVER_VERSION: "1.18.0",
    OH_CANVAS_SAFE_STATE_DIR: "/tmp/my-state",
  };

  it("rejects a relative state directory, naming the key", () => {
    expect(() =>
      launcherDefaultsEnv(environmentWins, withStateDir("state"), home),
    ).toThrow(
      "paths.stateDir in config/defaults.json must be an absolute path or start with ~/, got: state",
    );
  });

  it.each([
    "michaeltheologitis/software-agent-sdk",
    "git@github.com:example/software-agent-sdk",
    "git+https://github.com/example/software-agent-sdk",
    "http://github.com/example/software-agent-sdk",
    "file:///srv/git/software-agent-sdk",
  ])(
    "rejects a repo that is not an https or ssh URL, naming the key (%s)",
    (repo) => {
      expect(() =>
        launcherDefaultsEnv(
          environmentWins,
          defaultsWith({ sources: { agentServerGitRepo: repo } }),
          home,
        ),
      ).toThrow(
        `sources.agentServerGitRepo in config/defaults.json must be an https or ssh git URL, got: ${repo}`,
      );
    },
  );

  it.each([
    ["", '""'],
    ["   ", '"   "'],
  ])("rejects an empty or whitespace-only ref (%j)", (ref, shown) => {
    expect(() =>
      launcherDefaultsEnv(
        environmentWins,
        defaultsWith({ sources: { agentServerGitRef: ref } }),
        home,
      ),
    ).toThrow(
      `sources.agentServerGitRef in config/defaults.json must be a non-empty string, got: ${shown}`,
    );
  });
});

describe("applyLauncherDefaults", () => {
  it("fills only unset variables and returns their names, sorted", () => {
    const env: Record<string, string | undefined> = {
      OH_CANVAS_SAFE_STATE_DIR: "/tmp/my-state",
      UNRELATED: "kept",
    };

    const filled = applyLauncherDefaults(env, {
      ...forkSource,
      paths: { stateDir },
    });

    expect(filled).toEqual([
      "OH_AGENT_SERVER_GIT_REF",
      "OH_AGENT_SERVER_GIT_REPO",
    ]);
    expect(env).toEqual({
      OH_CANVAS_SAFE_STATE_DIR: "/tmp/my-state",
      UNRELATED: "kept",
      OH_AGENT_SERVER_GIT_REF: commitSha,
      OH_AGENT_SERVER_GIT_REPO: forkRepo,
    });
  });
});
