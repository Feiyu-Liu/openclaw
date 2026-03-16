---
summary: "Use the generated Postman collection for Gateway WebSocket RPC"
read_when:
  - Testing the Gateway protocol in Postman
  - Understanding the Gateway req/res/event flow
title: "Postman Collection"
---

# Postman collection

The generated Gateway Postman collection is a **WebSocket RPC** collection, not a REST collection.
Use it to open a WebSocket connection to the Gateway, send JSON RPC frames, and inspect `res` and `event` frames while the socket stays open.

For the wire format and handshake rules, see [Gateway Protocol](/gateway/protocol).

## What this collection is for

- Open a WebSocket connection to the Gateway (`ws://` or `wss://`)
- Run the protocol handshake in the correct order
- Send `req` frames for Gateway methods such as `health`, `chat.send`, or `sessions.list`
- Inspect matching `res` frames and any async `event` frames on the same connection

## What this collection is not

- It is **not** the OpenAI-compatible HTTP API
- It is **not** the OpenResponses HTTP API
- It is **not** a set of REST endpoints where each request opens and closes independently

The Gateway WebSocket protocol is stateful. You connect once, complete the handshake, then continue sending `req` frames and receiving `res` plus `event` frames on that same socket.

## Import into Postman

1. Open Postman.
2. Import the generated collection JSON file.
3. Set the collection variables for your Gateway URL and auth values.
4. Open the WebSocket request saved in the collection.
5. Connect before sending any protocol messages.

If your Gateway requires auth, make sure the collection variables include the same token or password configured on the Gateway host.

## Execution flow

Use the collection in this order.

### 1. Connect to the WebSocket endpoint

Connect Postman to the Gateway WebSocket URL, for example:

```text
ws://127.0.0.1:18789/
wss://gateway.example.com/
```

After the socket opens, the Gateway sends a pre-connect challenge event.

### 2. Wait for `connect.challenge`

The Gateway sends an event frame like:

```json
{
  "type": "event",
  "event": "connect.challenge",
  "payload": {
    "nonce": "...",
    "ts": 1737264000000
  }
}
```

Do not send application RPCs before this step. The challenge provides the nonce that the `connect` request must bind to.

### 3. Send `connect`

Send a `req` frame with method `connect`.
The exact payload depends on your client role, scopes, auth mode, and device identity, but the shape is:

```json
{
  "type": "req",
  "id": "connect-1",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "postman",
      "version": "1.0.0",
      "platform": "postman",
      "mode": "operator"
    },
    "role": "operator",
    "scopes": ["operator.read"],
    "auth": {
      "token": "..."
    },
    "device": {
      "id": "device_fingerprint",
      "publicKey": "...",
      "signature": "...",
      "signedAt": 1737264000000,
      "nonce": "..."
    }
  }
}
```

The important protocol detail is that the `device.nonce` and signature must correspond to the earlier `connect.challenge` event.

### 4. Wait for the `connect` response

A successful handshake returns a `res` frame with `ok: true` and a `hello-ok` payload:

```json
{
  "type": "res",
  "id": "connect-1",
  "ok": true,
  "payload": {
    "type": "hello-ok",
    "protocol": 3
  }
}
```

After this point, the connection is ready for normal Gateway RPC traffic.

### 5. Send normal RPC requests

Now you can send additional `req` frames such as:

- `health`
- `system-presence`
- `sessions.list`
- `chat.send`
- `chat.history`

Each request should use a unique `id` so you can match the later `res` frame.

## How to read frames in Postman

There are three frame types on the Gateway socket:

- `req` - a client request with `method` and `params`
- `res` - the server response that matches a prior request `id`
- `event` - an async server push frame that is not tied to a single request

A typical session looks like this:

1. Gateway sends `event(connect.challenge)`
2. Client sends `req(connect)`
3. Gateway sends `res(connect)`
4. Client sends `req(chat.send)`
5. Gateway sends zero or more `event(chat)` or `event(agent)` frames while work is running
6. Gateway sends the final `res(chat.send)`

That is why this collection is best thought of as a live RPC conversation over one socket, not as a sequence of unrelated HTTP calls.

## Common mistakes

- Treating the collection as REST instead of WebSocket RPC
- Sending `connect` before reading `connect.challenge`
- Reusing the wrong nonce in `device.nonce` or signature payload
- Forgetting that async `event` frames can arrive between request and final response
- Assuming every useful operation is exposed as HTTP instead of the Gateway WebSocket protocol

## Related

- [Gateway Protocol](/gateway/protocol)
- [Authentication](/gateway/authentication)
- [Gateway runbook](/gateway/index)
