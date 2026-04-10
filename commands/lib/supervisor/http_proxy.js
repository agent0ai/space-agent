import http from "node:http";
import net from "node:net";

function sendNoActiveServer(res) {
  const body = `${JSON.stringify({ error: "No active Space Agent server is ready." })}\n`;

  res.writeHead(503, {
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(body);
}

function proxyHttpRequest(req, res, activeChild) {
  const tracker = activeChild.beginProxyStream();
  const upstreamRequest = http.request(
    {
      headers: req.headers,
      hostname: activeChild.host,
      method: req.method,
      path: req.url,
      port: activeChild.port
    },
    (upstreamResponse) => {
      upstreamResponse.on("data", () => {
        tracker.markActivity();
      });
      res.writeHead(
        upstreamResponse.statusCode || 502,
        upstreamResponse.statusMessage,
        upstreamResponse.headers
      );
      upstreamResponse.pipe(res);
    }
  );

  upstreamRequest.once("error", (error) => {
    tracker.end();

    if (res.headersSent) {
      res.destroy(error);
      return;
    }

    const body = `${JSON.stringify({ error: "Active Space Agent server is unavailable." })}\n`;
    res.writeHead(502, {
      "Content-Length": Buffer.byteLength(body),
      "Content-Type": "application/json; charset=utf-8"
    });
    res.end(body);
  });

  req.on("data", () => {
    tracker.markActivity();
  });
  res.once("finish", () => {
    tracker.end();
  });
  res.once("close", () => {
    tracker.end();
  });
  req.pipe(upstreamRequest);
}

function writeUpgradeRequest(socket, req, head) {
  socket.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);

  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    socket.write(`${req.rawHeaders[index]}: ${req.rawHeaders[index + 1]}\r\n`);
  }

  socket.write("\r\n");

  if (head && head.length > 0) {
    socket.write(head);
  }
}

function proxyUpgradeRequest(req, socket, head, activeChild) {
  const tracker = activeChild.beginProxyStream();
  const upstreamSocket = net.connect(activeChild.port, activeChild.host, () => {
    writeUpgradeRequest(upstreamSocket, req, head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });

  socket.on("data", () => {
    tracker.markActivity();
  });
  upstreamSocket.on("data", () => {
    tracker.markActivity();
  });
  socket.once("close", () => {
    tracker.end();
  });
  upstreamSocket.once("close", () => {
    tracker.end();
  });
  upstreamSocket.once("error", () => {
    tracker.end();
    socket.destroy();
  });
  socket.once("error", () => {
    tracker.end();
    upstreamSocket.destroy();
  });
}

function createSupervisorProxy({ getActiveChild, host, port }) {
  const server = http.createServer((req, res) => {
    const activeChild = getActiveChild();

    if (!activeChild) {
      sendNoActiveServer(res);
      return;
    }

    proxyHttpRequest(req, res, activeChild);
  });

  server.on("upgrade", (req, socket, head) => {
    const activeChild = getActiveChild();

    if (!activeChild) {
      socket.destroy();
      return;
    }

    proxyUpgradeRequest(req, socket, head, activeChild);
  });

  return {
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.removeListener("error", reject);
          resolve();
        });
      });

      const address = server.address();
      const activePort = address && typeof address === "object" ? address.port : port;
      const browserHost = host === "0.0.0.0" || host === "::" || host === "[::]" ? "127.0.0.1" : host;

      return {
        browserUrl: `http://${browserHost}:${activePort}`,
        port: activePort
      };
    }
  };
}

export { createSupervisorProxy };
