import type { IncomingMessage, ServerResponse } from "node:http";

export const stunFixtureHost = "stun-fixture.test";
export const stunFixtureDNS = {
  servers: [
    {
      type: "hosts",
      tag: "fixture-hosts",
      predefined: { [stunFixtureHost]: "127.0.0.1" },
    },
  ],
  final: "fixture-hosts",
};

export function stunBindingResponse(request: Buffer, port: number, otherPort?: number) {
  if (request.length < 20 || request.readUInt16BE(0) !== 1) return;
  const response = Buffer.alloc(otherPort ? 44 : 32);
  request.copy(response, 0, 0, 20);
  response.writeUInt16BE(0x0101, 0);
  response.writeUInt16BE(response.length - 20, 2);
  response.writeUInt16BE(0x0020, 20); // XOR-MAPPED-ADDRESS
  response.writeUInt16BE(8, 22);
  response.writeUInt8(1, 25);
  response.writeUInt16BE(port ^ 0x2112, 26);
  response.writeUInt32BE(0x7f000001 ^ 0x2112a442, 28);
  if (otherPort) {
    response.writeUInt16BE(0x802c, 32); // OTHER-ADDRESS
    response.writeUInt16BE(8, 34);
    response.writeUInt8(1, 37);
    response.writeUInt16BE(otherPort, 38);
    response.writeUInt32BE(0x7f000002, 40);
  }
  return response;
}

export function serveDiagnostics(req: IncomingMessage, res: ServerResponse) {
  switch (req.url) {
    case "/config": {
      const base = `http://127.0.0.1:${req.socket.localPort}`;
      res.end(JSON.stringify({
        version: 1,
        urls: {
          small_download_url: `${base}/small`,
          large_download_url: `${base}/large`,
          upload_url: `${base}/upload`,
        },
      }));
      break;
    }
    case "/small":
      res.end("sample");
      break;
    case "/large": {
      const chunk = Buffer.alloc(16_384);
      const write = setInterval(() => {
        if (!res.writableNeedDrain) res.write(chunk);
      }, 5);
      res.once("close", () => clearInterval(write));
      break;
    }
    case "/upload":
      req.on("data", () => {
        req.pause();
        setTimeout(() => req.resume(), 5);
      });
      req.once("end", () => res.end());
      break;
    case "/probe":
      res.writeHead(204).end();
      break;
    default:
      res.writeHead(404).end();
  }
}
