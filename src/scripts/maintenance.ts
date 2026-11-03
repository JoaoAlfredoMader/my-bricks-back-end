import { loadEnv } from "../config/env.js";
import { createContainer } from "../container.js";
import { runMaintenance } from "../modules/maintenance/maintenance.js";

/** One maintenance run, for a cron job or by hand: `npm run maintenance`. */
const { prisma, storage } = createContainer(loadEnv(), { withoutDemoData: true });
try {
  console.log(JSON.stringify(await runMaintenance({ prisma, storage }), null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
