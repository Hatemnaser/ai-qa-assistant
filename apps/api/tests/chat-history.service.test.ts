import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createChatHistoryService } from "../src/modules/chat-history/chat-history.service.ts";
import type {
  ChatHistoryRepository,
  SaveUserChatInput,
  StoredChatRecord,
  StoredMessageRecord,
} from "../src/modules/chat-history/chat-history.repository.ts";
import type { StoredChatInput } from "../src/modules/chat-history/chat-history.types.ts";

const NOW = new Date("2026-05-21T10:00:00.000Z");

describe("chat history service", () => {
  it("saves and lists chats for the owning user only", async () => {
    const { repository, service } = setupChatHistoryService();

    await service.saveUserChat(
      "user-1",
      createStoredChatInput({
        id: "chat-1",
        messages: [
          {
            id: "message-1",
            role: "assistant",
            content: "Saved answer",
            mode: "general",
            model: "gemini-2.5-flash",
            createdAt: "2026-05-21T10:00:00.000Z",
            isError: true,
            attachments: [
              {
                type: "file",
                name: "requirements.md",
                mimeType: "text/markdown",
              },
            ],
          },
        ],
      })
    );
    await service.saveUserChat("user-2", createStoredChatInput({ id: "chat-2", title: "Other user chat" }));

    const userChats = await service.listUserChats("user-1");

    assert.equal(repository.chats.length, 2);
    assert.deepEqual(
      userChats.map((chat) => chat.id),
      ["chat-1"]
    );
    assert.equal(userChats[0].messages[0]?.content, "Saved answer");
    assert.equal(userChats[0].messages[0]?.isError, true);
    assert.deepEqual(userChats[0].messages[0]?.attachments, [
      {
        type: "file",
        name: "requirements.md",
        mimeType: "text/markdown",
      },
    ]);
  });

  it("updates chats owned by the current user", async () => {
    const { repository, service } = setupChatHistoryService([
      createFakeChatRecord({
        id: "chat-1",
        title: "Old title",
        userId: "user-1",
      }),
    ]);

    const updatedChat = await service.saveUserChat(
      "user-1",
      createStoredChatInput({
        id: "chat-1",
        title: "Updated title",
      })
    );

    assert.equal(updatedChat.title, "Updated title");
    assert.equal(repository.chats.length, 1);
    assert.equal(repository.chats[0].title, "Updated title");
  });

  it("rejects updates to chats owned by another user", async () => {
    const { repository, service } = setupChatHistoryService([
      createFakeChatRecord({
        id: "chat-1",
        title: "Private chat",
        userId: "user-1",
      }),
    ]);

    await assert.rejects(
      () => service.saveUserChat("user-2", createStoredChatInput({ id: "chat-1", title: "Stolen edit" })),
      {
        code: "CHAT_NOT_FOUND",
        statusCode: 404,
      }
    );
    assert.equal(repository.chats[0].title, "Private chat");
  });

  it("deletes only chats owned by the current user", async () => {
    const { repository, service } = setupChatHistoryService([
      createFakeChatRecord({
        id: "chat-1",
        userId: "user-1",
      }),
      createFakeChatRecord({
        id: "chat-2",
        userId: "user-2",
      }),
    ]);

    await service.deleteUserChat("user-1", "chat-1");

    assert.deepEqual(
      repository.chats.map((chat) => chat.id),
      ["chat-2"]
    );
  });

  it("rejects deletes for chats owned by another user", async () => {
    const { repository, service } = setupChatHistoryService([
      createFakeChatRecord({
        id: "chat-1",
        userId: "user-1",
      }),
    ]);

    await assert.rejects(() => service.deleteUserChat("user-2", "chat-1"), {
      code: "CHAT_NOT_FOUND",
      statusCode: 404,
    });
    assert.equal(repository.chats.length, 1);
  });

  it("strips attachment preview data from stored chat DTOs", async () => {
    const { service } = setupChatHistoryService([
      createFakeChatRecord({
        id: "chat-1",
        messages: [
          {
            id: "message-1",
            role: "USER",
            content: "Uploaded an image.",
            mode: "general",
            model: "gemini-2.5-flash",
            attachment: [
              {
                type: "image",
                name: "screen.png",
                mimeType: "image/png",
                previewUrl: "data:image/png;base64,abc",
              },
            ],
            metadata: null,
            createdAt: NOW,
          },
        ],
        userId: "user-1",
      }),
    ]);

    const [chat] = await service.listUserChats("user-1");

    assert.deepEqual(chat?.messages[0]?.attachments, [
      {
        type: "image",
        name: "screen.png",
        mimeType: "image/png",
      },
    ]);
  });
});

function setupChatHistoryService(initialChats: FakeChatRecord[] = []): ChatHistoryServiceTestContext {
  const repository = createFakeChatHistoryRepository(initialChats);
  const service = createChatHistoryService({
    now: () => NOW,
    repository,
  });

  return {
    repository,
    service,
  };
}

interface ChatHistoryServiceTestContext {
  repository: FakeChatHistoryRepository;
  service: ReturnType<typeof createChatHistoryService>;
}

interface FakeChatHistoryRepository extends ChatHistoryRepository {
  chats: FakeChatRecord[];
}

interface FakeChatRecord extends StoredChatRecord {
  userId: string;
}

function createFakeChatHistoryRepository(initialChats: FakeChatRecord[] = []): FakeChatHistoryRepository {
  const repository: FakeChatHistoryRepository = {
    chats: [...initialChats],

    async deleteUserChat(userId, chatId): Promise<number> {
      const chatIndex = repository.chats.findIndex((chat) => chat.id === chatId && chat.userId === userId);

      if (chatIndex === -1) return 0;

      repository.chats.splice(chatIndex, 1);

      return 1;
    },

    async findChatOwner(chatId) {
      const chat = repository.chats.find((item) => item.id === chatId);

      return chat ? { userId: chat.userId } : null;
    },

    async listUserChats(userId) {
      return repository.chats
        .filter((chat) => chat.userId === userId)
        .sort((first, second) => second.updatedAt.getTime() - first.updatedAt.getTime());
    },

    async saveUserChat(input: SaveUserChatInput) {
      const existingChatIndex = repository.chats.findIndex((chat) => chat.id === input.chat.id);
      const savedChat = createFakeChatRecord({
        id: input.chat.id,
        title: input.chat.title,
        mode: input.chat.mode,
        model: input.chat.model,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        messages: input.messages.map(toStoredMessageRecord),
        userId: input.userId,
      });

      if (existingChatIndex === -1) {
        repository.chats.push(savedChat);
      } else {
        repository.chats[existingChatIndex] = savedChat;
      }

      return savedChat;
    },
  };

  return repository;
}

function createFakeChatRecord(overrides: Partial<FakeChatRecord> = {}): FakeChatRecord {
  return {
    id: "chat-1",
    title: "Saved chat",
    mode: "general",
    model: "gemini-2.5-flash",
    createdAt: new Date("2026-05-21T09:00:00.000Z"),
    updatedAt: new Date("2026-05-21T09:00:00.000Z"),
    messages: [],
    userId: "user-1",
    ...overrides,
  };
}

function createStoredChatInput(overrides: Partial<StoredChatInput> = {}): StoredChatInput {
  return {
    id: "chat-1",
    title: "Saved chat",
    mode: "general",
    model: "gemini-2.5-flash",
    createdAt: "2026-05-21T09:00:00.000Z",
    updatedAt: "2026-05-21T09:30:00.000Z",
    messages: [],
    ...overrides,
  };
}

function toStoredMessageRecord(message: SaveUserChatInput["messages"][number]): StoredMessageRecord {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    mode: message.mode,
    model: message.model,
    attachment: message.attachment || null,
    metadata: message.metadata || null,
    createdAt: message.createdAt,
  };
}
