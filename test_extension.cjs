/**
 * vscode_extension/extension.js against a fake DeskLemurOS endpoint and a fake `vscode` module.
 * - The token comes from pairing, which the user allows in DeskLemurOS; a token no longer taken is asked for again.
 * - The agents are listed as models, and a request carries the token and the workspace folder.
 * - The stream's steps come back quoted before the answer.
 * - The MCP server is registered with the same token.
 * - Stop closes the request.
 */
const assert = require('node:assert');
const test = require('node:test');
const http = require('node:http');
const Module = require('node:module');

class TextPart { constructor(value) { this.value = value; } }
class Emitter { constructor() { this.listeners = []; this.event = l => this.listeners.push(l); } fire() { this.listeners.forEach(l => l()); } }
const secrets = new Map();
let endpointSetting = '';
const registered = {};
let pairings = 0;
const messagesShown = [];
const fakeVscode = {
    LanguageModelTextPart: TextPart,
    LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
    EventEmitter: Emitter,
    workspace: {
        workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/Users/you/code/site' } }],
        getConfiguration: () => ({ get: () => endpointSetting }),
        onDidChangeConfiguration: () => ({ dispose() {} }),
    },
    ProgressLocation: { Notification: 15 },
    Uri: { parse: value => ({ toString: () => value }) },
    McpHttpServerDefinition: class { constructor(label, uri, headers, version) { Object.assign(this, { label, uri, headers, version }); } },
    window: {
        createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
        showInputBox: async () => 'TOKEN-FROM-USER',
        withProgress: (options, task) => task({ report() {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
        showInformationMessage: async message => { messagesShown.push(message); return undefined; },
        showWarningMessage: async message => { messagesShown.push(message); return undefined; },
    },
    lm: {
        registerLanguageModelChatProvider: (vendor, provider) => { registered[vendor] = provider; return { dispose() {} }; },
        registerMcpServerDefinitionProvider: (id, provider) => { registered[`mcp:${id}`] = provider; return { dispose() {} }; },
    },
    commands: { registerCommand: () => ({ dispose() {} }) },
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    return request === 'vscode' ? fakeVscode : originalLoad.call(this, request, ...rest);
};

function frame(delta, finish = null) {
    return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

async function serve(handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    endpointSetting = `http://127.0.0.1:${server.address().port}/`;
    return server;
}

const context = { subscriptions: [], secrets: { get: async key => secrets.get(key), store: async (key, value) => secrets.set(key, value),
    delete: async key => secrets.delete(key) } };
require('./extension.js').activate(context);
const provider = registered.desklemuros;

test('the agents are the models, and a reply streams the steps quoted, then the answer', async () => {
    const seen = [];
    const server = await serve((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            seen.push({ url: req.url, auth: req.headers.authorization, project: req.headers['x-desklemuros-project'], body });
            if (req.url === '/mcp/pair') {
                pairings += 1;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'allowed', token: 'PAIRED-TOKEN' }));
                return;
            }
            if (req.headers.authorization === 'Bearer STALE') {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Missing or wrong token. Copy it from DeskLemurOS.' } }));
                return;
            }
            if (req.url === '/agents/v1/models') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ data: [{ id: 'agent_14q7ygkzj', name: 'LEMUR' }] }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.write(frame({ role: 'assistant', content: '' }));
            res.write(': keep-alive\n\n');
            res.write(frame({ reasoning_content: 'Read app.py\nEdit app.py\n' }));
            res.write(frame({ content: '> ⏳ LEMUR waits for you in DeskLemurOS (approve or deny): Allow file_edit?\n\n' }));
            res.write(frame({ content: 'Changed the greeting.' }));
            res.end(frame({}, 'stop') + 'data: [DONE]\n\n');
        });
    });
    try {
        secrets.clear();
        assert.deepEqual(await provider.provideLanguageModelChatInformation({ silent: true }), [], 'no token: nothing listed silently');
        assert.equal(pairings, 0, 'never asks DeskLemurOS silently');
        const models = await provider.provideLanguageModelChatInformation({ silent: false });
        assert.equal(pairings, 1);
        assert.equal(secrets.get('desklemuros.token'), 'PAIRED-TOKEN', 'paired once, kept in secret storage');
        const pairBody = JSON.parse(seen.find(item => item.url === '/mcp/pair').body);
        assert.deepEqual(pairBody, { client: 'VS Code', workspace: '/Users/you/code/site' });
        const [mcp] = await registered['mcp:desklemuros'].provideMcpServerDefinitions();
        assert.equal(mcp.uri.toString(), `${endpointSetting.replace(/\/$/, '')}/mcp`);
        assert.deepEqual(mcp.headers, { Authorization: 'Bearer PAIRED-TOKEN' }, 'the MCP server gets the same token');
        assert.deepEqual(models.map(m => [m.id, m.name, m.capabilities.toolCalling]), [['agent_14q7ygkzj', 'LEMUR', true]]);
        const parts = [];
        const messages = [{ role: 1, content: [new TextPart('<userRequest>Change the greeting</userRequest>')] }];
        await provider.provideLanguageModelChatResponse(models[0], messages, {}, { report: part => parts.push(part.value) },
            { onCancellationRequested: () => ({ dispose() {} }) });
        const text = parts.join('');
        assert.match(text, /> Read app\.py\n> Edit app\.py\n/);
        assert.match(text, /waits for you in DeskLemurOS/);
        assert.ok(text.trimEnd().endsWith('Changed the greeting.'));
        const request = seen.find(item => item.url === '/agents/v1/chat/completions');
        assert.equal(request.auth, 'Bearer PAIRED-TOKEN');
        assert.equal(request.project, '/Users/you/code/site', 'the open folder, from VS Code itself');
        const sent = JSON.parse(request.body);
        assert.equal(sent.model, 'agent_14q7ygkzj');
        assert.equal(sent.stream, true);
        assert.deepEqual(sent.messages, [{ role: 'user', content: '<userRequest>Change the greeting</userRequest>' }]);
        // After New token in DeskLemurOS: the old token is dropped, the current one asked for, the request sent again.
        secrets.set('desklemuros.token', 'STALE');
        const again = [];
        await provider.provideLanguageModelChatResponse(models[0], messages, {}, { report: part => again.push(part.value) },
            { onCancellationRequested: () => ({ dispose() {} }) });
        assert.equal(pairings, 2);
        assert.equal(secrets.get('desklemuros.token'), 'PAIRED-TOKEN');
        assert.ok(again.join('').trimEnd().endsWith('Changed the greeting.'));
    } finally {
        server.close();
    }
});

test('a refusal is shown as DeskLemurOS said it, and Stop closes the request', async () => {
    let closed = false;
    const server = await serve((req, res) => {
        if (req.url === '/mcp/pair') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'denied', message: 'The connection was denied in DeskLemurOS.' }));
            return;
        }
        if (req.headers.authorization === 'Bearer wrong') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Missing or wrong token.' } }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(frame({ reasoning_content: 'Working\n' }));
        req.on('close', () => { closed = true; });
    });
    try {
        secrets.set('desklemuros.token', 'wrong');
        await assert.rejects(provider.provideLanguageModelChatResponse({ id: 'x' }, [], {}, { report() {} },
            { onCancellationRequested: () => ({ dispose() {} }) }), /No DeskLemurOS access token/);
        assert.ok(messagesShown.includes('DeskLemurOS: The connection was denied in DeskLemurOS.'), 'a denial is said, not retried');
        secrets.set('desklemuros.token', 'right');
        let cancel;
        const parts = [];
        const running = provider.provideLanguageModelChatResponse({ id: 'x' }, [], {}, { report: part => parts.push(part.value) },
            { onCancellationRequested: listener => { cancel = listener; return { dispose() {} }; } });
        for (let i = 0; i < 50 && !parts.length; i += 1) await new Promise(resolve => setTimeout(resolve, 20));
        cancel();
        await running;
        for (let i = 0; i < 50 && !closed; i += 1) await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(closed, true, 'the request is closed, which stops the turn in DeskLemurOS');
    } finally {
        server.closeAllConnections?.();
        server.close();
    }
});
