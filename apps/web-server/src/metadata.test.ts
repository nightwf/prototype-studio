import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryMetadataStore } from "./metadata";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("file-persisted metadata", () => {
  it("restores users and projects after a restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "prototype-meta-"));
    temporaryRoots.push(root);
    const file = join(root, "metadata.json");

    const first = new MemoryMetadataStore(file);
    const user = await first.createUser("持久化", "persist@example.com", "hash", "user-1");
    await first.createProject({ id: "project-1", ownerId: user.id, name: "P", status: "active", spacePath: "/tmp/p", createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z" });

    const second = new MemoryMetadataStore(file);
    expect((await second.getUserById("user-1"))?.name).toBe("持久化");
    expect((await second.getProjectById("project-1"))?.name).toBe("P");
  });
});
