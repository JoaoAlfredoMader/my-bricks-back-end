import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrismaClient } from "../../src/lib/prisma.js";
import { propertySubtypes, propertyTypeUsages, transactionCategories } from "./data/catalog.js";

/**
 * Seeds the reference data the app depends on. Idempotent: safe to run on every deploy.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const prisma = createPrismaClient(databaseUrl);
const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), "data");

async function seedCities() {
  const rows = JSON.parse(await readFile(resolve(dataDir, "cities.json"), "utf8")) as [number, string, string][];
  const result = await prisma.city.createMany({
    data: rows.map(([ibgeCode, name, state]) => ({ ibgeCode, name, state })),
    skipDuplicates: true,
  });
  return { dataset: rows.length, inserted: result.count };
}

async function seedPropertySubtypes() {
  const result = await prisma.propertySubtype.createMany({ data: [...propertySubtypes], skipDuplicates: true });
  return { dataset: propertySubtypes.length, inserted: result.count };
}

async function seedPropertyTypeUsages() {
  const result = await prisma.propertyTypeUsage.createMany({ data: [...propertyTypeUsages], skipDuplicates: true });
  return { dataset: propertyTypeUsages.length, inserted: result.count };
}

async function seedTransactionCategories() {
  const result = await prisma.transactionCategory.createMany({ data: [...transactionCategories], skipDuplicates: true });
  return { dataset: transactionCategories.length, inserted: result.count };
}

async function main() {
  const report = {
    cities: await seedCities(),
    propertySubtypes: await seedPropertySubtypes(),
    propertyTypeUsages: await seedPropertyTypeUsages(),
    transactionCategories: await seedTransactionCategories(),
  };
  for (const [name, { dataset, inserted }] of Object.entries(report)) {
    console.log(`${name}: ${inserted} inserted, ${dataset - inserted} already present`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
