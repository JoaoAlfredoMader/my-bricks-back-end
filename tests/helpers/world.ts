import { loadEnv } from "../../src/config/env.js";
import { createContainer } from "../../src/container.js";

/**
 * The real app wired against the test database, called in-process (no network). Guests start with
 * an empty workspace here, so the tests that count rows are not affected by the sample portfolio;
 * `createContainer(env)` without the option is what the demo tests use.
 */
export const env = loadEnv();
const container = createContainer(env, { withoutDemoData: true });
export const { prisma, app, storage, auth } = container;

/** Wipes users, organizations and everything that hangs from them. Reference data is kept. */
export async function resetDatabase(): Promise<void> {
  const [row] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  const name = row?.current_database;
  if (!name?.endsWith("_test")) throw new Error(`Refusing to truncate "${name}": not a test database`);
  await prisma.$executeRawUnsafe(`TRUNCATE users, organizations, verifications RESTART IDENTITY CASCADE`);
}

export interface ApiResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

export interface UploadPart {
  name: string;
  type: string;
  bytes: Uint8Array;
  /** Form field name; defaults to `file`. */
  field?: string;
}

export interface DownloadResponse {
  status: number;
  headers: Headers;
  bytes: Buffer;
}

/** A browser-like client: keeps the session cookies between calls. */
export class Session {
  private cookie = "";

  /** `target` is the app to call; it defaults to the test world's (use another to test a differently wired app). */
  constructor(private readonly target: { request: typeof app.request } = app) {}

  async call(
    method: string,
    path: string,
    body?: unknown,
    rawBody?: string,
    headers: Record<string, string> = {},
  ): Promise<ApiResponse> {
    const res = await this.target.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        origin: env.FRONTEND_URL,
        ...headers,
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    this.storeCookies(res.headers.getSetCookie());

    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* empty or not JSON */
    }
    return { status: res.status, json };
  }

  /** Sends a multipart form, the way a browser uploads a file. */
  async upload(path: string, file: UploadPart | null, fields: Record<string, string> = {}): Promise<ApiResponse> {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    if (file) form.append(file.field ?? "file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));

    const res = await this.target.request(path, {
      method: "POST",
      // No content-type: the runtime adds the multipart boundary.
      headers: { origin: env.FRONTEND_URL, ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: form,
    });
    this.storeCookies(res.headers.getSetCookie());
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* empty or not JSON */
    }
    return { status: res.status, json };
  }

  /** Fetches a binary response (an image or a document). */
  async download(path: string): Promise<DownloadResponse> {
    const res = await this.target.request(path, {
      method: "GET",
      headers: { origin: env.FRONTEND_URL, ...(this.cookie ? { cookie: this.cookie } : {}) },
    });
    return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
  }

  private storeCookies(setCookies: string[]): void {
    if (setCookies.length === 0) return;
    const jar = new Map(this.cookie.split("; ").filter(Boolean).map((pair) => [pair.split("=")[0]!, pair] as const));
    for (const header of setCookies) {
      const pair = header.split(";")[0]!;
      const name = pair.split("=")[0]!;
      if (/Max-Age=0/i.test(header) || pair.endsWith("=")) jar.delete(name);
      else jar.set(name, pair);
    }
    this.cookie = [...jar.values()].join("; ");
  }
}

export interface Account {
  session: Session;
  userId: string;
  organizationId: string;
}

/** Signs up with e-mail and password; the account lands in its own personal organization. */
export async function signUp(name: string, email: string): Promise<Account> {
  const session = new Session();
  const response = await session.call("POST", "/api/auth/sign-up/email", { name, email, password: "senha-forte-123" });
  if (response.status !== 200) throw new Error(`sign-up failed for ${email}: ${JSON.stringify(response)}`);
  const me = await session.call("GET", "/api/me");
  return { session, userId: me.json.user.id, organizationId: me.json.organizationId };
}

/** Makes `member` a plain member of the owner's organization and activates it on their session. */
export async function joinAsMember(owner: Account, member: Account): Promise<void> {
  await prisma.member.create({ data: { organizationId: owner.organizationId, userId: member.userId, role: "member" } });
  const response = await member.session.call("POST", "/api/auth/organization/set-active", {
    organizationId: owner.organizationId,
  });
  if (response.status !== 200) throw new Error(`set-active failed: ${JSON.stringify(response)}`);
}

/** Creates three accounts: an owner, a member of the owner's organization, and an outsider. */
export async function createCast() {
  const ana = await signUp("Ana Souza", "ana@example.com");
  const bia = await signUp("Bia Lima", "bia@example.com");
  const carlos = await signUp("Carlos Dias", "carlos@example.com");
  await joinAsMember(ana, bia);
  return { ana, bia, carlos };
}
