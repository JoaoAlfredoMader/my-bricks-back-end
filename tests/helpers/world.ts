import { createApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createPrismaClient } from "../../src/lib/prisma.js";
import { createAuth } from "../../src/modules/auth/auth.js";
import { createProvisioningRepository } from "../../src/modules/auth/provisioning.repository.js";
import { createProvisioningService } from "../../src/modules/auth/provisioning.service.js";

/** The real app wired against the test database, called in-process (no network). */
export const env = loadEnv();
export const prisma = createPrismaClient(env.DATABASE_URL);

const provisioning = createProvisioningService(createProvisioningRepository(prisma), {
  demoTtlHours: env.DEMO_TTL_HOURS,
});
const auth = createAuth({ prisma, env, provisioning });
export const app = createApp({ prisma, env, auth, provisioning });

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

/** A browser-like client: keeps the session cookies between calls. */
export class Session {
  private cookie = "";

  async call(method: string, path: string, body?: unknown, rawBody?: string): Promise<ApiResponse> {
    const res = await app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        origin: env.FRONTEND_URL,
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
