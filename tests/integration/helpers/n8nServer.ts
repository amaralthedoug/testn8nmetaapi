// tests/integration/helpers/n8nServer.ts
import http from 'node:http';

export interface FakeN8nServer {
  getUrl(): string;
  waitForRequest(timeoutMs?: number): Promise<unknown>;
  requestCount: number;
  reset(): void;
  close(): Promise<void>;
}

export async function startFakeN8n(): Promise<FakeN8nServer> {
  const queue: unknown[] = [];
  const pending: Array<(body: unknown) => void> = [];
  let requestCount = 0;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requestCount++;
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { parsed = body; }

      // Send response FIRST so deliver() can complete and call updateStatus('forwarded')
      // before waitForRequest() resolves in the test — prevents the forwarded-status race.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }), () => {
        // Callback fires after response is fully written to socket.
        if (pending.length > 0) {
          pending.shift()!(parsed);
        } else {
          queue.push(parsed);
        }
      });
    });
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;

  return {
    getUrl: () => url,

    waitForRequest(timeoutMs = 3000): Promise<unknown> {
      if (queue.length > 0) {
        return Promise.resolve(queue.shift()!);
      }
      return new Promise((resolve, reject) => {
        // Store the wrapper so the timeout handler can find and remove it by reference.
        let wrapper: ((body: unknown) => void) | undefined;
        const timer = setTimeout(() => {
          const idx = pending.indexOf(wrapper!);
          if (idx !== -1) pending.splice(idx, 1);
          reject(new Error(`waitForRequest: no request received within ${timeoutMs}ms`));
        }, timeoutMs);

        wrapper = (body: unknown) => {
          clearTimeout(timer);
          resolve(body);
        };
        pending.push(wrapper);
      });
    },

    get requestCount() { return requestCount; },

    reset() {
      queue.length = 0;
      requestCount = 0;
    },

    close(): Promise<void> {
      return new Promise((resolve, reject) =>
        server.close(err => err ? reject(err) : resolve())
      );
    },
  };
}
