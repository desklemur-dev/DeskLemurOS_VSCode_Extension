# DeskLemurOS Agents for VS Code

Your DeskLemurOS agents in VS Code's chat **model picker**. Pick an agent (for example LEMUR) and your chat message goes
straight to it. The agent runs its own turn in DeskLemurOS:

- you allow the workspace folder in the DeskLemurOS window;
- writes and commands wait in **Approvals**;
- the answer is checked before it comes back.

VS Code's own tools are not used. The reply shows the agent's steps, anything it waits for in DeskLemurOS, then the
answer and the files it changed. **Stop** in VS Code stops the turn.

## Requirements

DeskLemurOS running on this computer (https://desklemur.com). The extension talks only to it, at `127.0.0.1`, and sends
no telemetry.

## Setup

1. DeskLemurOS: **Easy Setup › Connections › Coding tools**, then **Turn on** (it can also install this extension for
   you). Or **Settings › System**: turn on the **CLI / HTTP API Port** and **Coding tools (MCP)**.
2. VS Code: answer **Connect** when the extension asks, or run **DeskLemurOS: Connect**.
3. DeskLemurOS shows *VS Code wants to use your agents*: choose **Allow**. The extension receives the access token and
   keeps it in VS Code's secret storage. No token is copied by hand.
4. Open the chat's model picker and choose your agent under **DeskLemurOS**. If it is not listed, open
   **Manage Language Models** and show it.

The same connection registers DeskLemurOS's MCP server (`ask_agent` and the rest) with VS Code, so no
`.vscode/mcp.json` is needed. After **New token** in DeskLemurOS, the next request asks for the new token again.
**DeskLemurOS: Set Access Token** remains for pasting a token by hand. The API address is the `desklemuros.endpoint`
setting (default `http://127.0.0.1:8000`).

## Acknowledgments

Development support: **OpenAI Codex**.

## License

MIT OR Apache-2.0, at your option (LICENSE-MIT, LICENSE-APACHE). Home page: https://desklemur.com

