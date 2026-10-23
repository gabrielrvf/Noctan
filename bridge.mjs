#!/usr/bin/env node
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createNoctanMcpServer } from "./noctan-mcp.mjs";

const baseUrl = String(
  process.env.NOCTAN_URL || "http://127.0.0.1:4177",
).replace(/\/$/, "");

function openLocalUrl(url) {
  const os = platform();
  const command =
    os === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : os === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(command[0], command[1], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

const server = createNoctanMcpServer({
  baseUrl,
  openLocalUrl: process.env.NOCTAN_NO_OPEN === "1" ? null : openLocalUrl,
});

await server.connect(new StdioServerTransport());
