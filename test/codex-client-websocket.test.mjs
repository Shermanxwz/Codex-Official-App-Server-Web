import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import { once } from 'node:events';
import { CodexAppServer } from '../src/codex-client.mjs';

function websocketFrame(payload) {
  const body = Buffer.from(payload);
  let header;
  if (body.length < 126) header = Buffer.from([0x81, body.length]);
  else if (body.length <= 0xffff) {
    header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  return Buffer.concat([header, body]);
}

async function fakeWebSocketAppServer() {
  const clients = new Set();
  const server = net.createServer((socket) => {
    clients.add(socket);
    let upgraded = false;
    let input = Buffer.alloc(0);
    const send = (message) => { if (!socket.destroyed) socket.write(websocketFrame(JSON.stringify(message))); };
    const handle = (message) => {
      if (message.method === 'initialize') {
        send({ id: message.id, result: { codexHome: '/fake', platformFamily: 'unix', platformOs: 'linux' } });
      } else if (message.method === 'initialized') {
        // The official server accepts this notification after initialize.
      } else if (message.method === 'thread/list') {
        send({ id: message.id, result: { data: [{ id: 'thread-ws', preview: 'persistent' }] } });
      } else if (message.method === 'test/requestServer') {
        send({ id: message.id, result: { ok: true } });
        send({ id: 99, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-ws' } });
      } else if (message.id === 99 && message.result?.decision === 'accept') {
        socket.emit('approval-response');
      }
    };
    const parseFrames = () => {
      while (input.length >= 2) {
        const first = input[0], second = input[1];
        const opcode = first & 0x0f;
        let length = second & 0x7f;
        let offset = 2;
        if (length === 126) { if (input.length < 4) return; length = input.readUInt16BE(2); offset = 4; }
        else if (length === 127) { if (input.length < 10) return; const wide = input.readBigUInt64BE(2); if (wide > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('test frame too large'); length = Number(wide); offset = 10; }
        const masked = Boolean(second & 0x80);
        if (!masked) throw new Error('client WebSocket frame must be masked');
        if (input.length < offset + 4 + length) return;
        const mask = input.subarray(offset, offset + 4); offset += 4;
        const body = Buffer.from(input.subarray(offset, offset + length));
        input = input.subarray(offset + length);
        for (let index = 0; index < body.length; index += 1) body[index] ^= mask[index % 4];
        if (opcode === 0x8) { socket.end(); return; }
        if (opcode === 0x1) handle(JSON.parse(body.toString('utf8')));
      }
    };
    socket.on('data', (chunk) => {
      input = Buffer.concat([input, chunk]);
      if (!upgraded) {
        const end = input.indexOf('\r\n\r\n');
        if (end < 0) return;
        const headers = input.subarray(0, end).toString('latin1');
        const key = headers.match(/\r\nsec-websocket-key:\s*([^\r\n]+)/i)?.[1]?.trim();
        if (!key) { socket.destroy(); return; }
        const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        input = input.subarray(end + 4); upgraded = true;
      }
      parseFrames();
    });
    socket.on('error', () => {});
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  return {
    url: `ws://127.0.0.1:${port}`,
    close: async () => {
      for (const socket of clients) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

test('CodexAppServer supports the persistent official WebSocket transport', { skip: typeof globalThis.WebSocket !== 'function' }, async (t) => {
  const fixture = await fakeWebSocketAppServer();
  t.after(() => fixture.close());
  const client = new CodexAppServer({ transport: 'websocket', serverUrl: fixture.url, timeoutMs: 2_000 });
  t.after(() => client.close());
  const initialize = await client.start();
  assert.equal(initialize.platformOs, 'linux');
  assert.equal(client.isReady(), true);
  const list = await client.request('thread/list', {});
  assert.equal(list.data[0].id, 'thread-ws');
  const serverRequest = once(client, 'serverRequest');
  await client.request('test/requestServer', {});
  const [request] = await serverRequest;
  assert.equal(request.method, 'item/commandExecution/requestApproval');
  client.respond(request.id, { decision: 'accept' });
  client.close();
});
