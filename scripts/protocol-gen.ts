import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  isNodeRoleMethod,
  resolveLeastPrivilegeOperatorScopesForMethod,
} from "../src/gateway/method-scopes.js";
import { PROTOCOL_VERSION, ProtocolSchemas } from "../src/gateway/protocol/schema.js";
import { GATEWAY_EVENTS } from "../src/gateway/server-methods-list.js";

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  examples?: unknown[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  patternProperties?: Record<string, JsonSchema>;
  minimum?: number;
  minItems?: number;
};

type PostmanDescriptionOptions = {
  requestExample?: unknown;
  responseExample?: unknown;
  eventExample?: unknown;
  paramsSchemaName?: string;
  resultSchemaName?: string;
  scopes: string[];
  moduleName: string;
  isConnect?: boolean;
  notes?: string[];
};

type PostmanItem = {
  name: string;
  item?: PostmanItem[];
  request?: {
    description: string;
    header: Array<{ key: string; value: string }>;
    url: { raw: string };
  };
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const serverMethodsDir = path.join(repoRoot, "src", "gateway", "server-methods");
const jsonSchemaPath = path.join(repoRoot, "dist", "protocol.schema.json");
const postmanCollectionPath = path.join(
  repoRoot,
  "dist",
  "openclaw-gateway.postman_collection.json",
);

const requestSchemaOverrides: Record<string, string> = {
  connect: "ConnectParams",
};

const resultSchemaOverrides: Record<string, string> = {
  connect: "HelloOk",
  "config.schema": "ConfigSchemaResponse",
  "config.schema.lookup": "ConfigSchemaLookupResult",
};

const eventSchemaByName: Record<string, string | undefined> = {
  agent: "AgentEvent",
  chat: "ChatEvent",
  shutdown: "ShutdownEvent",
  tick: "TickEvent",
  "device.pair.requested": "DevicePairRequestedEvent",
  "device.pair.resolved": "DevicePairResolvedEvent",
  "node.invoke.request": "NodeInvokeRequestEvent",
};

function titleCase(input: string) {
  return input
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function pascalCase(input: string) {
  return input
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function stableStringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function normalizeType(schema: JsonSchema): string | undefined {
  if (Array.isArray(schema.type)) {
    return schema.type.find((value) => value !== "null") ?? schema.type[0];
  }
  return schema.type;
}

function firstConcreteVariant(schemas: JsonSchema[] | undefined): JsonSchema | undefined {
  if (!schemas || schemas.length === 0) {
    return undefined;
  }
  return schemas.find((candidate) => normalizeType(candidate) !== "null") ?? schemas[0];
}

function schemaByName(name: string | undefined): JsonSchema | undefined {
  if (!name) {
    return undefined;
  }
  return ProtocolSchemas[name as keyof typeof ProtocolSchemas] as JsonSchema | undefined;
}

function inferParamsSchemaName(method: string): string | undefined {
  const override = requestSchemaOverrides[method];
  if (override) {
    return override;
  }
  const candidate = `${pascalCase(method)}Params`;
  return schemaByName(candidate) ? candidate : undefined;
}

function inferResultSchemaName(method: string): string | undefined {
  const override = resultSchemaOverrides[method];
  if (override) {
    return override;
  }
  const candidate = `${pascalCase(method)}Result`;
  return schemaByName(candidate) ? candidate : undefined;
}

function numericExample(fieldName: string | undefined, schema: JsonSchema): number {
  switch (fieldName) {
    case "minProtocol":
    case "maxProtocol":
    case "protocol":
      return PROTOCOL_VERSION;
    case "timeoutMs":
      return 30_000;
    case "limit":
      return 50;
    case "maxBytes":
      return 16_384;
    case "cursor":
    case "seq":
      return 0;
    case "ts":
    case "signedAt":
    case "issuedAtMs":
      return 1_737_264_000_000;
    case "tickIntervalMs":
      return 15_000;
    case "maxPayload":
      return 1_048_576;
    case "maxBufferedBytes":
      return 2_097_152;
    default:
      return schema.minimum ?? 0;
  }
}

function stringExample(fieldName: string | undefined, pathSegments: string[]): string {
  const pathKey = pathSegments.join(".");
  switch (pathKey) {
    case "client.id":
      return "postman";
    case "client.displayName":
      return "Postman Gateway Client";
    case "client.version":
      return "1.0.0";
    case "client.platform":
      return "macos";
    case "client.mode":
      return "operator";
    case "auth.token":
      return "{{gateway_token}}";
    case "auth.deviceToken":
      return "{{device_token}}";
    case "auth.password":
      return "{{gateway_password}}";
    case "device.id":
      return "{{device_id}}";
    case "device.publicKey":
      return "{{device_public_key}}";
    case "device.signature":
      return "{{device_signature}}";
    case "device.nonce":
      return "{{connect_nonce}}";
    default:
      break;
  }

  switch (fieldName) {
    case "id":
      return "{{request_id}}";
    case "role":
      return "operator";
    case "userAgent":
      return "openclaw-postman/1.0.0";
    case "locale":
      return "en-US";
    case "sessionKey":
      return "main";
    case "sessionId":
      return "{{session_id}}";
    case "agentId":
      return "{{agent_id}}";
    case "runId":
      return "{{run_id}}";
    case "clientRunId":
      return "{{client_run_id}}";
    case "idempotencyKey":
      return "{{idempotency_key}}";
    case "message":
      return "Hello from Postman";
    case "text":
      return "Hello from Postman";
    case "to":
      return "{{recipient}}";
    case "replyTo":
      return "{{reply_to}}";
    case "channel":
      return "{{channel}}";
    case "replyChannel":
      return "{{reply_channel}}";
    case "accountId":
    case "replyAccountId":
      return "{{account_id}}";
    case "threadId":
      return "{{thread_id}}";
    case "groupId":
      return "{{group_id}}";
    case "groupChannel":
      return "{{group_channel}}";
    case "groupSpace":
      return "{{group_space}}";
    case "event":
      return "{{event_name}}";
    case "reason":
      return "manual";
    case "label":
      return "Postman request";
    case "publicKey":
      return "{{device_public_key}}";
    case "signature":
      return "{{device_signature}}";
    case "nonce":
      return "{{connect_nonce}}";
    default:
      return fieldName ? `{{${fieldName}}}` : "{{value}}";
  }
}

function exampleFromSchema(schema: JsonSchema | undefined, pathSegments: string[] = []): unknown {
  if (!schema) {
    return undefined;
  }
  if (schema.default !== undefined) {
    return schema.default;
  }
  if (schema.examples && schema.examples.length > 0) {
    return schema.examples[0];
  }
  if (schema.const !== undefined) {
    return schema.const;
  }
  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[0];
  }

  const unionVariant =
    firstConcreteVariant(schema.anyOf) ??
    firstConcreteVariant(schema.oneOf) ??
    firstConcreteVariant(schema.allOf);
  if (unionVariant) {
    return exampleFromSchema(unionVariant, pathSegments);
  }

  const type = normalizeType(schema);
  const fieldName = pathSegments[pathSegments.length - 1];

  switch (type) {
    case "object": {
      const props = schema.properties ?? {};
      const required = new Set(schema.required ?? []);
      const example: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        if (!required.has(key)) {
          continue;
        }
        const child = exampleFromSchema(value, [...pathSegments, key]);
        if (child !== undefined) {
          example[key] = child;
        }
      }
      if (Object.keys(example).length > 0) {
        return example;
      }
      const patternSchema = schema.patternProperties
        ? Object.values(schema.patternProperties)[0]
        : undefined;
      if (patternSchema) {
        return { example: exampleFromSchema(patternSchema, [...pathSegments, "example"]) };
      }
      return {};
    }
    case "array": {
      const itemExample = exampleFromSchema(schema.items, [...pathSegments, "item"]);
      const minItems = schema.minItems ?? 0;
      if (minItems > 0 && itemExample !== undefined) {
        return [itemExample];
      }
      return [];
    }
    case "integer":
    case "number":
      return numericExample(fieldName, schema);
    case "boolean":
      return fieldName === "enabled" || fieldName === "deliver";
    case "string":
      return stringExample(fieldName, pathSegments);
    case "null":
      return null;
    default:
      return fieldName ? { [fieldName]: "runtime-specific" } : {};
  }
}

async function collectMethodModules() {
  const entries = await fs.readdir(serverMethodsDir, { withFileTypes: true });
  const moduleByMethod = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      continue;
    }
    const filePath = path.join(serverMethodsDir, entry.name);
    const sourceText = await fs.readFile(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
    const moduleName = titleCase(entry.name.replace(/\.ts$/, ""));

    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text.endsWith("Handlers") &&
        node.initializer &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        for (const property of node.initializer.properties) {
          if (!ts.isPropertyAssignment(property)) {
            continue;
          }
          const nameNode = property.name;
          const methodName =
            ts.isStringLiteral(nameNode) || ts.isNoSubstitutionTemplateLiteral(nameNode)
              ? nameNode.text
              : ts.isIdentifier(nameNode)
                ? nameNode.text
                : undefined;
          if (!methodName) {
            continue;
          }
          moduleByMethod.set(methodName, moduleName);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return moduleByMethod;
}

function buildRequestFrameExample(method: string): unknown {
  const paramsSchemaName = inferParamsSchemaName(method);
  const paramsSchema = schemaByName(paramsSchemaName);
  const paramsExample = exampleFromSchema(paramsSchema);
  const frame: Record<string, unknown> = {
    type: "req",
    id: "{{request_id}}",
    method,
  };
  if (
    paramsExample !== undefined &&
    !(typeof paramsExample === "object" && paramsExample && Object.keys(paramsExample).length === 0)
  ) {
    frame.params = paramsExample;
  }
  return frame;
}

function buildResponseFrameExample(method: string): unknown {
  const payloadSchemaName = inferResultSchemaName(method);
  const payloadSchema = schemaByName(payloadSchemaName);
  const payloadExample = exampleFromSchema(payloadSchema);
  const frame: Record<string, unknown> = {
    type: "res",
    id: "{{request_id}}",
    ok: true,
  };
  if (
    payloadExample !== undefined &&
    !(
      typeof payloadExample === "object" &&
      payloadExample &&
      Object.keys(payloadExample).length === 0
    )
  ) {
    frame.payload = payloadExample;
  }
  return frame;
}

function buildEventExample(eventName: string): unknown {
  if (eventName === "connect.challenge") {
    return {
      type: "event",
      event: "connect.challenge",
      payload: {
        nonce: "{{connect_nonce}}",
        ts: 1_737_264_000_000,
      },
    };
  }

  const payloadSchema = schemaByName(eventSchemaByName[eventName]);
  const payloadExample = exampleFromSchema(payloadSchema);
  const frame: Record<string, unknown> = {
    type: "event",
    event: eventName,
  };
  if (
    payloadExample !== undefined &&
    !(
      typeof payloadExample === "object" &&
      payloadExample &&
      Object.keys(payloadExample).length === 0
    )
  ) {
    frame.payload = payloadExample;
  }
  if (eventName !== "connect.challenge") {
    frame.seq = 0;
  }
  return frame;
}

function scopeLabel(method: string, scopes: string[]) {
  if (method === "connect") {
    return "Role-scoped during handshake (`operator` or `node`)";
  }
  if (isNodeRoleMethod(method)) {
    return "Node role method";
  }
  if (scopes.length === 0) {
    return "Unclassified or runtime-specific";
  }
  return scopes.map((scope) => `\`${scope}\``).join(", ");
}

function buildDescription(title: string, options: PostmanDescriptionOptions) {
  const lines = [
    `${title} over the real Gateway WebSocket flow at \`{{gateway_ws_url}}\`.`,
    "",
    `Module: ${options.moduleName}`,
    `Required scopes: ${scopeLabel(title, options.scopes)}`,
  ];

  if (options.paramsSchemaName) {
    lines.push(`Params schema: \`${options.paramsSchemaName}\``);
  }
  if (options.resultSchemaName) {
    lines.push(`Result schema: \`${options.resultSchemaName}\``);
  }
  if (options.notes && options.notes.length > 0) {
    lines.push(`Notes: ${options.notes.join(" ")}`);
  }

  lines.push("");

  if (options.isConnect) {
    lines.push(
      "Handshake order: open the socket, wait for `connect.challenge`, then send the `connect` request as the first `req` frame.",
      "",
    );
  } else {
    lines.push(
      "Handshake prerequisite: complete `connect.challenge` -> `connect` before sending this frame.",
      "",
    );
  }

  if (options.eventExample) {
    lines.push("Event frame example:", "```json", stableStringify(options.eventExample), "```", "");
  }
  if (options.requestExample) {
    lines.push(
      "Request frame example:",
      "```json",
      stableStringify(options.requestExample),
      "```",
      "",
    );
  }
  if (options.responseExample) {
    lines.push(
      "Response frame example:",
      "```json",
      stableStringify(options.responseExample),
      "```",
      "",
    );
  }

  return lines.join("\n");
}

function makeWebSocketRequest(description: string) {
  return {
    description,
    header: [],
    url: { raw: "{{gateway_ws_url}}" },
  };
}

function buildMethodItem(method: string, moduleName: string): PostmanItem {
  const paramsSchemaName = inferParamsSchemaName(method);
  const resultSchemaName = inferResultSchemaName(method);
  const scopes = resolveLeastPrivilegeOperatorScopesForMethod(method);
  const requestExample = buildRequestFrameExample(method);
  const responseExample = buildResponseFrameExample(method);
  const description = buildDescription(method, {
    requestExample,
    responseExample,
    paramsSchemaName,
    resultSchemaName,
    scopes,
    moduleName,
    isConnect: method === "connect",
    notes:
      method === "connect"
        ? [
            "Send the server nonce back in `params.device.nonce` after signing it.",
            "Do not send any other request before `connect` succeeds.",
          ]
        : undefined,
  });

  return {
    name: method,
    request: makeWebSocketRequest(description),
  };
}

function buildEventItem(eventName: string, moduleName: string): PostmanItem {
  const eventSchemaName = eventSchemaByName[eventName];
  const eventExample = buildEventExample(eventName);
  const description = buildDescription(eventName, {
    eventExample,
    scopes: [],
    moduleName,
    notes: [
      "Events are pushed by the gateway after the WebSocket session is connected.",
      eventSchemaName
        ? `Payload schema: \`${eventSchemaName}\`.`
        : "Payload shape is runtime-defined.",
    ],
  });

  return {
    name: `${eventName} (event)`,
    request: makeWebSocketRequest(description),
  };
}

async function writeJsonSchema() {
  const definitions: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(ProtocolSchemas)) {
    definitions[name] = schema;
  }

  const rootSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://openclaw.ai/protocol.schema.json",
    title: "OpenClaw Gateway Protocol",
    description: "Handshake, request/response, and event frames for the Gateway WebSocket.",
    oneOf: [
      { $ref: "#/definitions/RequestFrame" },
      { $ref: "#/definitions/ResponseFrame" },
      { $ref: "#/definitions/EventFrame" },
    ],
    discriminator: {
      propertyName: "type",
      mapping: {
        req: "#/definitions/RequestFrame",
        res: "#/definitions/ResponseFrame",
        event: "#/definitions/EventFrame",
      },
    },
    definitions,
  };

  const distDir = path.join(repoRoot, "dist");
  await fs.mkdir(distDir, { recursive: true });
  await fs.writeFile(jsonSchemaPath, `${JSON.stringify(rootSchema, null, 2)}\n`);
  console.log(`wrote ${jsonSchemaPath}`);
}

async function writePostmanCollection() {
  const moduleByMethod = await collectMethodModules();
  const methodEntries = Array.from(moduleByMethod.entries()).toSorted((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const folderByModule = new Map<string, PostmanItem[]>();

  for (const [method, moduleName] of methodEntries) {
    const items = folderByModule.get(moduleName) ?? [];
    items.push(buildMethodItem(method, moduleName));
    folderByModule.set(moduleName, items);
  }

  const folderByEventModule = new Map<string, PostmanItem[]>();
  for (const eventName of [...GATEWAY_EVENTS].toSorted((a, b) => a.localeCompare(b))) {
    const moduleKey = titleCase(eventName.split(".")[0] ?? "Events");
    const items = folderByEventModule.get(moduleKey) ?? [];
    items.push(buildEventItem(eventName, moduleKey));
    folderByEventModule.set(moduleKey, items);
  }

  const handshakeFolder: PostmanItem = {
    name: "Handshake",
    item: [
      buildEventItem("connect.challenge", "Handshake"),
      buildMethodItem("connect", moduleByMethod.get("connect") ?? "Connect"),
    ],
  };

  const moduleFolders: PostmanItem[] = [];
  for (const moduleName of [...folderByModule.keys()].toSorted((a, b) => a.localeCompare(b))) {
    const items = folderByModule.get(moduleName) ?? [];
    const eventItems = folderByEventModule.get(moduleName) ?? [];
    const dedupedItems = [
      ...eventItems.filter((item) => item.name !== "connect.challenge (event)"),
      ...items.filter((item) => item.name !== "connect"),
    ];
    if (dedupedItems.length === 0) {
      continue;
    }
    moduleFolders.push({
      name: moduleName,
      item: dedupedItems,
    });
  }

  const ungroupedEventFolders = [...folderByEventModule.entries()]
    .filter(([moduleName]) => !folderByModule.has(moduleName) && moduleName !== "Connect")
    .toSorted((a, b) => a[0].localeCompare(b[0]))
    .map(([moduleName, items]) => ({
      name: `${moduleName} Events`,
      item: items,
    }));

  const collection = {
    info: {
      name: "OpenClaw Gateway WebSocket",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      description:
        "Generated examples for the OpenClaw Gateway WebSocket protocol. These requests keep the real WebSocket flow: wait for connect.challenge, send connect, then exchange req/res/event JSON frames over the same socket.",
    },
    variable: [
      {
        key: "gateway_ws_url",
        value: "ws://127.0.0.1:18789",
        type: "string",
      },
      {
        key: "gateway_token",
        value: "replace-me",
        type: "string",
      },
      {
        key: "gateway_password",
        value: "",
        type: "string",
      },
      {
        key: "device_token",
        value: "",
        type: "string",
      },
      {
        key: "connect_nonce",
        value: "replace-after-challenge",
        type: "string",
      },
      {
        key: "device_id",
        value: "replace-device-id",
        type: "string",
      },
      {
        key: "device_public_key",
        value: "replace-device-public-key",
        type: "string",
      },
      {
        key: "device_signature",
        value: "replace-device-signature",
        type: "string",
      },
      {
        key: "request_id",
        value: "req-1",
        type: "string",
      },
      {
        key: "idempotency_key",
        value: "idem-1",
        type: "string",
      },
      {
        key: "session_id",
        value: "",
        type: "string",
      },
      {
        key: "agent_id",
        value: "default",
        type: "string",
      },
      {
        key: "run_id",
        value: "",
        type: "string",
      },
    ],
    item: [handshakeFolder, ...moduleFolders, ...ungroupedEventFolders],
  };

  await fs.mkdir(path.dirname(postmanCollectionPath), { recursive: true });
  await fs.writeFile(postmanCollectionPath, `${JSON.stringify(collection, null, 2)}\n`);
  console.log(`wrote ${postmanCollectionPath}`);
}

async function main() {
  await writeJsonSchema();
  await writePostmanCollection();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
