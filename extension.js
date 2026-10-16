// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright (c) 2026 desklemur-dev

// DeskLemurOS's agents as models in VS Code's chat model picker (the user, 2026-10-16: call LEMUR directly from VS
// Code). VS Code's own route for this, Copilot's Custom Endpoint models, never registered in the Insiders build tried:
// its BYOK contribution needs a proposed API that build withholds. This extension uses the stable language model
// provider API instead.
//
// Each request goes to DeskLemurOS's agent model endpoint (core/agent_model_api.py). There the agent runs its own turn
// with DeskLemurOS's guardrails: the folder is allowed in the app window, changes wait in Approvals, and the answer is
// checked. VS Code's tools are not used. The open workspace folder is sent as X-DeskLemurOS-Project. Steps and waits
// stream as quoted lines before the answer. Stop in VS Code closes the request, which stops the turn.
//
// The access token is the Coding tools token, kept in VS Code's secret storage. It is not copied by hand. The
// extension asks DeskLemurOS for it (POST /mcp/pair), and the user allows or denies that in the DeskLemurOS window. A
// token DeskLemurOS no longer accepts (New token) is dropped and asked for again. The same token also registers
// DeskLemurOS's MCP server (ask_agent and the rest) with VS Code, so .vscode/mcp.json is not needed.
'use strict';

const vscode = require('vscode');

const VENDOR = 'desklemuros';
const TOKEN_KEY = 'desklemuros.token';
const PAIR_TIMEOUT_MS = 130000;

function endpoint() {
    const base = String(vscode.workspace.getConfiguration('desklemuros').get('endpoint') || 'http://127.0.0.1:8000');
    return base.replace(/\/+$/, '');
}

function messageText(message) {
    // A request message's text parts (the stable API's LanguageModelTextPart).
    return (message.content || []).map(part => (part instanceof vscode.LanguageModelTextPart ? part.value
        : (typeof part === 'string' ? part : ''))).join('');
}

function workspaceFolder() {
    const folder = (vscode.workspace.workspaceFolders || [])[0];
    return folder && folder.uri.scheme === 'file' ? folder.uri.fsPath : '';
}

class AgentModels {
    constructor(context) {
        this.context = context;
        this.changed = new vscode.EventEmitter();
        this.onDidChangeLanguageModelChatInformation = this.changed.event;
        this.output = vscode.window.createOutputChannel('DeskLemurOS Agents');
    }

    async token(ask) {
        let value = await this.context.secrets.get(TOKEN_KEY);
        if (!value && ask) value = await this.pair();
        return value || '';
    }

    async store(value) {
        if (value) await this.context.secrets.store(TOKEN_KEY, value);
        else await this.context.secrets.delete(TOKEN_KEY);
        this.changed.fire();
        this.onTokenChange?.();
    }

    async pair() {
        // Ask DeskLemurOS for the token; the user allows it in the DeskLemurOS window.
        if (this.pairing) return this.pairing;
        this.pairing = vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification, cancellable: true,
            title: 'DeskLemurOS: allow VS Code in the DeskLemurOS window (a notification there asks you)…',
        }, async (_progress, cancel) => {
            const aborter = new AbortController();
            const stop = cancel.onCancellationRequested(() => aborter.abort());
            const timer = setTimeout(() => aborter.abort(), PAIR_TIMEOUT_MS);
            try {
                const reply = await fetch(`${endpoint()}/mcp/pair`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: aborter.signal,
                    body: JSON.stringify({ client: 'VS Code', workspace: workspaceFolder() }),
                });
                const body = await reply.json().catch(() => ({}));
                if (body.status === 'allowed' && body.token) {
                    await this.store(body.token);
                    vscode.window.showInformationMessage('DeskLemurOS connected: your agents are in the chat model picker.');
                    return body.token;
                }
                vscode.window.showWarningMessage(`DeskLemurOS: ${body.message || `not connected (${body.status || reply.status})`}`);
            } catch (error) {
                if (!aborter.signal.aborted) {
                    vscode.window.showWarningMessage(`DeskLemurOS is not reachable at ${endpoint()}: ${error.message || error}`);
                }
            } finally {
                clearTimeout(timer);
                stop.dispose();
            }
            return '';
        });
        try {
            return await this.pairing;
        } finally {
            this.pairing = null;
        }
    }

    async askToken() {
        const value = await vscode.window.showInputBox({
            title: 'DeskLemurOS access token',
            prompt: 'Copy it from DeskLemurOS: Settings > System > Coding tools (MCP) > Copy token.',
            password: true, ignoreFocusOut: true,
        });
        if (!value) return '';
        await this.store(value.trim());
        return value.trim();
    }

    async provideLanguageModelChatInformation(options) {
        const token = await this.token(!options.silent);
        if (!token) return [];
        try {
            const reply = await fetch(`${endpoint()}/agents/v1/models`, { headers: { Authorization: `Bearer ${token}` } });
            const body = await reply.json();
            if (reply.status === 403 && /token/i.test(body?.error?.message || '')) {
                // DeskLemurOS no longer takes this token (New token): drop it; the next request asks again.
                await this.store('');
                return [];
            }
            if (!reply.ok) throw new Error(body?.error?.message || `HTTP ${reply.status}`);
            return (body.data || []).map(agent => ({
                id: agent.id, name: agent.name || agent.id, family: 'desklemuros-agent', version: '1',
                tooltip: `${agent.name || agent.id} runs its own turn in DeskLemurOS, under its guardrails.`,
                detail: 'DeskLemurOS',
                maxInputTokens: 900000, maxOutputTokens: 32000,
                // Listed for agent mode; the agent never asks VS Code to run a tool.
                capabilities: { toolCalling: true, imageInput: false },
            }));
        } catch (error) {
            this.output.appendLine(`Agents could not be listed: ${error.message || error}`);
            return [];
        }
    }

    async provideLanguageModelChatResponse(model, messages, options, progress, cancel, retried = false) {
        const token = await this.token(true);
        if (!token) throw new Error('No DeskLemurOS access token: run "DeskLemurOS: Set Access Token".');
        const aborter = new AbortController();
        const stop = cancel.onCancellationRequested(() => aborter.abort());
        const folder = workspaceFolder();
        const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
        if (folder) headers['X-DeskLemurOS-Project'] = folder;
        const body = {
            model: model.id, stream: true,
            messages: messages.map(message => ({
                role: message.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user',
                content: messageText(message),
            })),
        };
        try {
            const reply = await fetch(`${endpoint()}/agents/v1/chat/completions`, {
                method: 'POST', headers, body: JSON.stringify(body), signal: aborter.signal,
            });
            if (!reply.ok || !reply.body) {
                let message = `HTTP ${reply.status}`;
                try { message = (await reply.json())?.error?.message || message; } catch (_) { /* not JSON */ }
                if (reply.status === 403 && /token/i.test(message) && !retried) {
                    // A token DeskLemurOS no longer takes: ask for the current one once, then send again.
                    await this.store('');
                    stop.dispose();
                    return this.provideLanguageModelChatResponse(model, messages, options, progress, cancel, true);
                }
                throw new Error(`DeskLemurOS: ${message}`);
            }
            let buffer = '';
            let thinking = false;
            const decoder = new TextDecoder();
            for await (const chunk of reply.body) {
                buffer += decoder.decode(chunk, { stream: true });
                let end;
                while ((end = buffer.indexOf('\n\n')) >= 0) {
                    const frame = buffer.slice(0, end);
                    buffer = buffer.slice(end + 2);
                    for (const line of frame.split('\n')) {
                        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
                        const delta = JSON.parse(line.slice(6))?.choices?.[0]?.delta || {};
                        if (delta.reasoning_content) {
                            // The agent's steps, quoted, before its answer.
                            const quoted = delta.reasoning_content.split('\n').filter(Boolean).map(text => `> ${text}\n`).join('');
                            progress.report(new vscode.LanguageModelTextPart((thinking ? '' : '\n') + quoted));
                            thinking = true;
                        }
                        if (delta.content) {
                            progress.report(new vscode.LanguageModelTextPart((thinking ? '\n' : '') + delta.content));
                            thinking = false;
                        }
                    }
                }
            }
        } catch (error) {
            if (aborter.signal.aborted) return;
            throw error;
        } finally {
            stop.dispose();
        }
    }

    async provideTokenCount(model, text) {
        const value = typeof text === 'string' ? text : messageText(text);
        return Math.ceil(value.length / 4);
    }
}

class McpServers {
    // DeskLemurOS's MCP server (ask_agent and the rest) for VS Code, with the token the extension holds.
    constructor(models) {
        this.models = models;
        this.changed = new vscode.EventEmitter();
        this.onDidChangeMcpServerDefinitions = this.changed.event;
    }

    async provideMcpServerDefinitions() {
        const token = await this.models.token(false);
        if (!token) return [];
        return [new vscode.McpHttpServerDefinition('DeskLemurOS', vscode.Uri.parse(`${endpoint()}/mcp`),
            { Authorization: `Bearer ${token}` }, '1')];
    }
}

function activate(context) {
    const provider = new AgentModels(context);
    const servers = new McpServers(provider);
    provider.onTokenChange = () => servers.changed.fire();
    context.subscriptions.push(
        vscode.lm.registerLanguageModelChatProvider(VENDOR, provider),
        vscode.lm.registerMcpServerDefinitionProvider('desklemuros', servers),
        vscode.commands.registerCommand('desklemuros.connect', () => provider.pair()),
        vscode.commands.registerCommand('desklemuros.setToken', () => provider.askToken()),
        vscode.commands.registerCommand('desklemuros.refreshAgents', () => provider.changed.fire()),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('desklemuros.endpoint')) {
                provider.changed.fire();
                servers.changed.fire();
            }
        }),
        provider.output,
    );
    // Not connected yet: offer it once per start rather than popping a request in DeskLemurOS unasked.
    provider.token(false).then(token => {
        if (token) return;
        vscode.window.showInformationMessage('Connect VS Code to your DeskLemurOS agents?', 'Connect')
            .then(choice => { if (choice === 'Connect') provider.pair(); });
    });
}

function deactivate() {}

module.exports = { activate, deactivate };
