// Prisma client singleton. Reusing one client across hot-reloads/requests avoids
// exhausting Postgres connections (prisma-patterns: serverless connection exhaustion).
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
