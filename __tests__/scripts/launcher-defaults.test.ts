// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyLauncherDefaults,
  launcherDefaultsEnv,
  readSetupConfig,
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

describe("launcherDefaultsEnv", () => {
  it("fills the agent-server's git repo and ref from defaults when the environment names no source", () => {
    expect(launcherDefaultsEnv({}, forkSource, home)).toEqual({
      OH_AGENT_SERVER_GIT_REPO: forkRepo,
      OH_AGENT_SERVER_GIT_REF: commitSha,
    });
  });

  it.each([
    ["OH_AGENT_SERVER_LOCAL_PATH", "/abs/path/to/software-agent-sdk"],
    ["OH_AGENT_SERVER_GIT_REF", "feature-branch"],
    ["OH_AGENT_SERVER_VERSION", "1.18.0"],
  ])(
    "an agent-server source in the environment wins over the defaults' ref (%s)",
    (name, value) => {
      const filled = launcherDefaultsEnv({ [name]: value }, forkSource, home);

      expect(filled).not.toHaveProperty("OH_AGENT_SERVER_GIT_REF");
    },
  );

  it("the defaults' repo still applies to a ref from the environment", () => {
    const filled = launcherDefaultsEnv(
      { OH_AGENT_SERVER_GIT_REF: "feature-branch" },
      forkSource,
      home,
    );

    expect(filled).toEqual({ OH_AGENT_SERVER_GIT_REPO: forkRepo });
  });

  it("the environment's repo wins over the defaults' repo", () => {
    const filled = launcherDefaultsEnv(
      { OH_AGENT_SERVER_GIT_REPO: "https://github.com/someone/else" },
      forkSource,
      home,
    );

    expect(filled).toEqual({ OH_AGENT_SERVER_GIT_REF: commitSha });
  });

  it("fills the state directory from defaults, expanding ~/ to the home directory", () => {
    const filled = launcherDefaultsEnv(
      {},
      defaultsWith({ paths: { stateDir: "~/.example-app/agent-canvas" } }),
      home,
    );

    expect(filled.OH_CANVAS_SAFE_STATE_DIR).toBe(
      path.join(home, ".example-app", "agent-canvas"),
    );
  });

  it("moves both key files into a state directory named by defaults", () => {
    const filled = launcherDefaultsEnv(
      {},
      defaultsWith({ paths: { stateDir: "/srv/example-app/agent-canvas" } }),
      home,
    );

    expect(filled).toEqual({
      OH_CANVAS_SAFE_STATE_DIR: "/srv/example-app/agent-canvas",
      OH_SECRET_KEY_PATH: path.join(
        "/srv/example-app/agent-canvas",
        "secret-key.txt",
      ),
      OH_SESSION_API_KEY_PATH: path.join(
        "/srv/example-app/agent-canvas",
        "api-key.txt",
      ),
    });
  });

  it("leaves the key files alone when the environment names the state directory", () => {
    const filled = launcherDefaultsEnv(
      { OH_CANVAS_SAFE_STATE_DIR: "/tmp/my-state" },
      defaultsWith({ paths: { stateDir: "/srv/example-app/agent-canvas" } }),
      home,
    );

    expect(filled).toEqual({});
  });

  it("key file paths in the environment win over the defaults' state directory", () => {
    const filled = launcherDefaultsEnv(
      {
        OH_SECRET_KEY_PATH: "/keys/secret.txt",
        OH_SESSION_API_KEY_PATH: "/keys/api.txt",
      },
      defaultsWith({ paths: { stateDir: "/srv/example-app/agent-canvas" } }),
      home,
    );

    expect(filled).toEqual({
      OH_CANVAS_SAFE_STATE_DIR: "/srv/example-app/agent-canvas",
    });
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
      launcherDefaultsEnv(
        environmentWins,
        defaultsWith({ paths: { stateDir: "state" } }),
        home,
      ),
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

  it("rejects an empty ref", () => {
    expect(() =>
      launcherDefaultsEnv(
        environmentWins,
        defaultsWith({ sources: { agentServerGitRef: "" } }),
        home,
      ),
    ).toThrow(
      'sources.agentServerGitRef in config/defaults.json must be a non-empty string, got: ""',
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
      paths: { stateDir: "/srv/example-app/agent-canvas" },
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

describe("readSetupConfig", () => {
  it("reads an argv setup command and runs it in both phases by default", () => {
    expect(
      readSetupConfig({ setup: { command: ["example-app", "setup"] } }),
    ).toEqual({
      command: ["example-app", "setup"],
      phases: ["before-start", "after-ready"],
    });
    expect(
      readSetupConfig({
        setup: {
          command: ["example-app", "setup"],
          phases: ["after-ready", "before-start"],
        },
      }),
    ).toEqual({
      command: ["example-app", "setup"],
      phases: ["before-start", "after-ready"],
    });
    expect(
      readSetupConfig({
        setup: { command: ["example-app", "setup"], phases: ["after-ready"] },
      }),
    ).toEqual({ command: ["example-app", "setup"], phases: ["after-ready"] });
  });

  it("a null setup command means no setup", () => {
    // Upstream's shape: the block is present, its command null.
    expect(
      readSetupConfig({
        setup: { command: null, phases: ["before-start", "after-ready"] },
      }),
    ).toBeNull();
    expect(readSetupConfig({})).toBeNull();
  });

  it.each([
    ["a string", "example-app setup", '"example-app setup"'],
    ["an empty array", [], "[]"],
    ["an empty argument", ["example-app", ""], '["example-app",""]'],
  ])("rejects a setup command given as %s", (_kind, command, shown) => {
    expect(() => readSetupConfig({ setup: { command } })).toThrow(
      `setup.command in config/defaults.json must be a non-empty array of non-empty strings, got: ${shown}`,
    );
  });

  it.each([
    [["first-launch"], '["first-launch"]'],
    [["before-start", "before-start"], '["before-start","before-start"]'],
    ["before-start", '"before-start"'],
  ])("rejects an unknown or repeated phase (%j)", (phases, shown) => {
    expect(() =>
      readSetupConfig({ setup: { command: ["example-app", "setup"], phases } }),
    ).toThrow(
      `setup.phases in config/defaults.json may list only "before-start" and "after-ready", got: ${shown}`,
    );
  });
});
