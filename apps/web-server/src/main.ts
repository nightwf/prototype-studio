import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildApp } from "./app";
import { MemoryMetadataStore } from "./metadata";
import { PostgresMetadataStore } from "./pgMetadata";
import { ProjectSpaceManager } from "./spaces";

const port = Number(process.env.PORT ?? 8787);
const spacesDir = process.env.SPACES_DIR ?? join(process.cwd(), "data", "spaces");
const inviteCodes = (process.env.INVITE_CODES ?? "PROTOTYPE-DEV").split(",").map((code) => code.trim()).filter(Boolean);
const baseUrl = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;

async function main(): Promise<void> {
  await mkdir(spacesDir, { recursive: true });
  const metadata = process.env.DATABASE_URL
    ? new PostgresMetadataStore(process.env.DATABASE_URL)
    : new MemoryMetadataStore();
  if (metadata instanceof PostgresMetadataStore) await metadata.migrate();
  const spaces = new ProjectSpaceManager(metadata, spacesDir);
  const app = await buildApp({ metadata, spaces, inviteCodes, baseUrl });
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`prototype-studio-web-server listening on http://127.0.0.1:${port}`);
}

void main();
