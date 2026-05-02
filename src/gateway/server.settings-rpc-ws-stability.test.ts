import fs from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { withEnvAsync } from "../test-utils/env.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import {
  connectOk,
  getFreePort,
  installGatewayTestHooks,
  onceMessage,
  startGatewayServer,
  testState,
  trackConnectChallengeNonce,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

type RpcResponse = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code?: string; message?: string };
};

async function openAuthenticatedWs(port: number, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  trackConnectChallengeNonce(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  await connectOk(ws, {
    token,
    client: {
      id: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      displayName: "MyClaw Companion",
      version: "test",
      platform: "companion",
      deviceFamily: "desktop",
      mode: GATEWAY_CLIENT_MODES.BACKEND,
      instanceId: "settings-rpc-ws-stability",
    },
    caps: ["tool-events"],
  });
  return ws;
}

async function sendRawRpc(
  ws: WebSocket,
  id: string,
  method: string,
  params?: unknown,
): Promise<RpcResponse> {
  const response = onceMessage<RpcResponse>(ws, (o) => o.type === "res" && o.id === id, 10_000);
  ws.send(JSON.stringify({ type: "req", id, method, params }));
  return await response;
}

describe("gateway settings RPC websocket stability", () => {
  const token = "settings-rpc-ws-stability-token";
  const originalGatewayAuth = testState.gatewayAuth;

  afterAll(() => {
    testState.gatewayAuth = originalGatewayAuth;
  });

  async function startSettingsRpcServer(): Promise<{
    server: Awaited<ReturnType<typeof startGatewayServer>>;
    port: number;
  }> {
    const configPath = process.env.OPENCLAW_CONFIG_PATH;
    if (!configPath) {
      throw new Error("OPENCLAW_CONFIG_PATH missing in gateway test environment");
    }
    testState.gatewayAuth = undefined;
    const port = await getFreePort();
    await fs.writeFile(
      configPath,
      `${JSON.stringify(
        {
          gateway: {
            auth: {
              mode: "token",
              token,
            },
          },
          skills: {
            entries: {},
          },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    const server = await withEnvAsync({ OPENCLAW_TEST_MINIMAL_GATEWAY: undefined }, async () =>
      startGatewayServer(port, { controlUiEnabled: false }),
    );
    return { server, port };
  }

  it("keeps the same shared-token websocket open after skills.update writes config", async () => {
    const { server, port } = await startSettingsRpcServer();
    const ws = await openAuthenticatedWs(port, token);
    try {
      const update = await sendRawRpc(ws, "skills-update", "skills.update", {
        skillKey: "demo-skill",
        enabled: true,
      });
      expect(update.ok, JSON.stringify(update)).toBe(true);

      const health = await sendRawRpc(ws, "health-after-skills-update", "health");
      expect(health.ok, JSON.stringify(health)).toBe(true);
    } finally {
      ws.close();
      await server.close();
    }
  });
});
