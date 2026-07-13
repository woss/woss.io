# API Reference

All endpoints return JSON. Error responses follow `{ error: string }` shape.

## Chat API

Base path: `/api/chat`

### POST /api/chat

Create or delete a chat.

**Request body:**

```json
{
  "userId": "string (required)",
  "action": "delete",
  "chatId": "string (required when action is delete)"
}
```

**Create chat** (default when `action` is omitted):

| Field    | Type   | Required | Description     |
| -------- | ------ | -------- | --------------- |
| `userId` | string | yes      | User identifier |

Response `200`:

```json
{ "id": "chat_abc123" }
```

**Delete chat** (`action: "delete"`):

| Field    | Type   | Required | Description                       |
| -------- | ------ | -------- | --------------------------------- |
| `userId` | string | yes      | User identifier (ownership check) |
| `chatId` | string | yes      | Chat to delete                    |

Response `200`:

```json
{ "success": true, "chatId": "chat_abc123" }
```

**Error responses:**

| Status | Body                                        | When                                  |
| ------ | ------------------------------------------- | ------------------------------------- |
| 400    | `{ error: "Invalid request body" }`         | Malformed or empty JSON body          |
| 400    | `{ error: "userId is required" }`           | Missing `userId` field                |
| 400    | `{ error: "chatId is required" }`           | Delete action missing `chatId`        |
| 400    | `{ error: "Maximum N chats allowed" }`      | User has reached `PUBLIC_MAX_CHATS`   |
| 403    | `{ error: "Forbidden" }`                    | `chatId` owner doesn't match `userId` |
| 404    | `{ error: "Chat not found" }`               | `chatId` doesn't exist                |
| 500    | `{ error: "Failed to create/delete chat" }` | Server-side failure                   |

### GET /api/chat

List chats for a user.

**Query parameters:**

| Param    | Type   | Required | Description     |
| -------- | ------ | -------- | --------------- |
| `userId` | string | yes      | User identifier |

Response `200`:

```json
{ "chats": [{ "id": "chat_abc123", ... }] }
```

## Client helpers

The project provides typed helper functions in `src/lib/chat/chat-crud.ts`:

```typescript
import { createChat, deleteChat } from '$lib/chat/chat-crud';

// Create — returns { id } or { error }
const result = await createChat(userId, baseUrl);

// Delete — returns true/false
const ok = await deleteChat(userId, chatId);
```

Both functions use `POST /api/chat` with a JSON body.
