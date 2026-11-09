import { createServer, type Server } from "node:net";

/** A minimal SMTP server that accepts every message and keeps the raw DATA. Test-only. */
export async function startSmtpSink(): Promise<{
  url: string;
  messages: string[];
  close: () => Promise<void>;
}> {
  const messages: string[] = [];
  const server: Server = createServer((socket) => {
    let buffer = "";
    let inData = false;
    let data = "";
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply("220 sink ESMTP");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (let i = buffer.indexOf("\r\n"); i !== -1; i = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            messages.push(data);
            data = "";
            reply("250 OK queued");
          } else {
            data += `${line.startsWith("..") ? line.slice(1) : line}\n`;
          }
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO") reply("250-sink\r\n250 8BITMIME");
        else if (cmd === "HELO") reply("250 sink");
        else if (cmd === "DATA") {
          inData = true;
          reply("354 End data with <CR><LF>.<CR><LF>");
        } else if (cmd === "QUIT") {
          reply("221 Bye");
          socket.end();
        } else reply("250 OK");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  return {
    url: `smtp://127.0.0.1:${address.port}`,
    messages,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
