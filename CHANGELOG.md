# Changelog

## 0.3.1

- Acknowledged Google DeepMind's Gemma 4 26B A4B for its role in DeskLemurOS local-agent development and testing.
- Added an acknowledgment for development support from OpenAI Codex.
- Listed publicly on the Visual Studio Marketplace, with links to the source, the issues and the website.
- Setup names DeskLemurOS's Easy Setup, which installs and connects the extension for you.

## 0.3.0

- Published as `desklemuros-dev.desklemuros-agents`; licensed under MIT or Apache-2.0.
- A question an agent asks ends the reply; your next message answers it in the same turn.

## 0.2.0

- Connect without copying a token: DeskLemurOS asks you to allow VS Code, then hands the extension its token.
- Registers DeskLemurOS's MCP server (`ask_agent` and the rest) with VS Code.
- A token DeskLemurOS no longer accepts is dropped and asked for again.

## 0.1.0

- Your DeskLemurOS agents in VS Code's chat model picker. Each request runs the agent's own turn in DeskLemurOS,
  under its guardrails.
