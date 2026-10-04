"""Mock ACP (Agent Client Protocol) server for E2E tests.

A minimal stdio-based ACP agent that speaks JSON-RPC over stdin/stdout.
The agent-server spawns this as a subprocess via ``acp_command`` and
communicates with it using the ACP protocol.

The agent responds to prompts with a scripted text reply containing
``REPLY_TOKEN``, which the E2E test verifies appeared in the UI.

``--session-controls`` adds session controls, mirroring the SDK's scripted test
agent: one ``select`` config option, ``profile`` (``fast`` or ``thorough``), and
slash commands that depend on it (``fast``: ``summarize``; ``thorough``:
``summarize`` and ``compare``). The first prompt clears the commands and fixes
the profile, and every reply then reads ``<REPLY_TOKEN> profile=<profile>``.

Usage:
    python mock-acp-server.py [--reply-token TOKEN] [--session-controls]

Requires:
    pip install agent-client-protocol  (installed as dep of openhands-sdk)
"""

import argparse
import asyncio
import sys

import acp
from acp.schema import (
    AgentCapabilities,
    AvailableCommand,
    AvailableCommandInput,
    AvailableCommandsUpdate,
    CloseSessionResponse,
    ConfigOptionUpdate,
    Implementation,
    PromptCapabilities,
    SessionCapabilities,
    SessionCloseCapabilities,
    SessionConfigOptionSelect,
    SessionConfigSelectOption,
    SetSessionConfigOptionResponse,
    UnstructuredCommandInput,
)

REPLY_TOKEN = "MOCK_ACP_E2E_REPLY_OK"

INVALID_PARAMS = -32602
OPTION_ID = "profile"
PROFILES = ("fast", "thorough")
# session/new must answer before its first available_commands_update.
COMMANDS_AFTER_NEW_SESSION_DELAY = 0.05
SUMMARIZE = AvailableCommand(name="summarize", description="Summarize the input")
COMPARE = AvailableCommand(
    name="compare",
    description="Compare two things",
    input=AvailableCommandInput(UnstructuredCommandInput(hint="what to compare")),
)
COMMANDS = {"fast": [SUMMARIZE], "thorough": [SUMMARIZE, COMPARE]}


class MockACPAgent(acp.Agent):
    """Minimal ACP agent that returns a scripted reply to every prompt."""

    def __init__(
        self, reply_token: str = REPLY_TOKEN, session_controls: bool = False
    ) -> None:
        self.reply_token = reply_token
        self.session_controls = session_controls
        self._conn: acp.Client | None = None
        self._profile = PROFILES[0]
        self._prompted = False
        self._background: set[asyncio.Task[None]] = set()

    def on_connect(self, conn: acp.Client) -> None:
        self._conn = conn

    async def initialize(
        self,
        protocol_version: int,
        client_capabilities=None,
        client_info=None,
        **kwargs,
    ) -> acp.InitializeResponse:
        print("[mock-acp] initialize", file=sys.stderr, flush=True)
        return acp.InitializeResponse(
            protocol_version=acp.PROTOCOL_VERSION,
            agent_info=Implementation(
                name="mock-acp-e2e",
                title="Mock ACP E2E Agent",
                version="1.0.0",
            ),
            agent_capabilities=AgentCapabilities(
                prompt_capabilities=PromptCapabilities(),
                session_capabilities=(
                    SessionCapabilities(close=SessionCloseCapabilities())
                    if self.session_controls
                    else None
                ),
            ),
        )

    async def new_session(
        self,
        cwd: str,
        additional_directories=None,
        **kwargs,
    ) -> acp.NewSessionResponse:
        print(f"[mock-acp] new_session cwd={cwd}", file=sys.stderr, flush=True)
        session_id = "mock-acp-session-001"
        if not self.session_controls:
            return acp.NewSessionResponse(session_id=session_id)
        self._send_commands_soon(session_id)
        return acp.NewSessionResponse(
            session_id=session_id, config_options=[self._option()]
        )

    async def set_config_option(
        self, config_id: str, session_id: str, value: str | bool, **kwargs
    ) -> SetSessionConfigOptionResponse:
        if config_id != OPTION_ID:
            raise acp.RequestError(INVALID_PARAMS, f"unknown option '{config_id}'")
        if value not in PROFILES:
            raise acp.RequestError(INVALID_PARAMS, f"unknown profile '{value}'")
        if self._prompted and value != self._profile:
            raise acp.RequestError(
                INVALID_PARAMS,
                "profile is fixed once the session has started "
                f"(it is '{self._profile}')",
            )
        self._profile = value
        await self._send_commands(session_id)
        return SetSessionConfigOptionResponse(config_options=[self._option()])

    async def close_session(self, session_id: str, **kwargs) -> CloseSessionResponse:
        return CloseSessionResponse()

    async def prompt(
        self,
        prompt,
        session_id: str,
        message_id: str | None = None,
        **kwargs,
    ) -> acp.PromptResponse:
        # Extract user text for logging
        user_text = ""
        if prompt:
            for block in prompt:
                if hasattr(block, "text"):
                    user_text += block.text
        print(
            f"[mock-acp] prompt session={session_id} text={user_text!r}",
            file=sys.stderr,
            flush=True,
        )

        reply = self.reply_token
        if self.session_controls:
            if not self._prompted:
                self._prompted = True
                await self._send_commands(session_id)
                await self._update(
                    session_id,
                    ConfigOptionUpdate(
                        session_update="config_option_update",
                        config_options=[self._option()],
                    ),
                )
            reply = f"{self.reply_token} profile={self._profile}"

        # Send the agent's text reply as a session/update notification
        await self._update(session_id, acp.update_agent_message_text(reply))

        return acp.PromptResponse(stop_reason="end_turn")

    def _option(self) -> SessionConfigOptionSelect:
        values = [self._profile] if self._prompted else list(PROFILES)
        return SessionConfigOptionSelect(
            type="select",
            id=OPTION_ID,
            name="Profile",
            current_value=self._profile,
            options=[SessionConfigSelectOption(value=v, name=v) for v in values],
        )

    async def _send_commands(self, session_id: str) -> None:
        commands = [] if self._prompted else COMMANDS[self._profile]
        await self._update(
            session_id,
            AvailableCommandsUpdate(
                session_update="available_commands_update",
                available_commands=commands,
            ),
        )

    def _send_commands_soon(self, session_id: str) -> None:
        async def send() -> None:
            await asyncio.sleep(COMMANDS_AFTER_NEW_SESSION_DELAY)
            await self._send_commands(session_id)

        task = asyncio.get_running_loop().create_task(send())
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    async def _update(self, session_id: str, update) -> None:
        if self._conn:
            await self._conn.session_update(session_id=session_id, update=update)


async def main(reply_token: str, session_controls: bool) -> None:
    agent = MockACPAgent(reply_token=reply_token, session_controls=session_controls)
    print(f"[mock-acp] starting (token={reply_token})", file=sys.stderr, flush=True)
    # session/close is in the unstable part of the protocol.
    await acp.run_agent(agent, use_unstable_protocol=session_controls)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Mock ACP agent for E2E tests")
    parser.add_argument(
        "--reply-token",
        default=REPLY_TOKEN,
        help="Token to include in agent replies (default: %(default)s)",
    )
    parser.add_argument(
        "--session-controls",
        action="store_true",
        help="Offer a profile config option and profile-dependent slash commands",
    )
    args = parser.parse_args()
    asyncio.run(main(args.reply_token, args.session_controls))
