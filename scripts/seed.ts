// Development seed: one verified demo user so you can sign in without email delivery.
// Safe to run repeatedly. Refuses to run in production. Later features add sample data here.
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { account, tasks, todos, user, userPreferences } from "../src/db/schema";
import { addDays } from "../src/lib/dates/calendar";
import { getUserToday } from "../src/lib/dates/today";
import { uuidv7 } from "../src/lib/ids";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on the real environment.
}

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed: NODE_ENV is production.");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const DEMO_EMAIL = "demo@dayboard.local";
const DEMO_PASSWORD = "demo-password-1234";

const client = postgres(url, { max: 1 });
const db = drizzle(client);

try {
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, DEMO_EMAIL));
  let userId = existing?.id;

  if (existing) {
    console.log(`Demo user already exists (${DEMO_EMAIL}).`);
  } else {
    userId = uuidv7();
    const id = userId;
    await db.transaction(async (tx) => {
      await tx
        .insert(user)
        .values({ id, name: "Demo User", email: DEMO_EMAIL, emailVerified: true });
      await tx.insert(account).values({
        id: uuidv7(),
        accountId: id,
        providerId: "credential",
        userId: id,
        password: await hashPassword(DEMO_PASSWORD),
      });
      await tx.insert(userPreferences).values({ userId: id, onboardedAt: new Date() });
    });
    console.log(`Created demo user.\n  email:    ${DEMO_EMAIL}\n  password: ${DEMO_PASSWORD}`);
  }

  if (userId) await seedTasks(userId);
} catch (error) {
  console.error("Seed failed:", error);
  process.exitCode = 1;
} finally {
  await client.end();
}

// Sample tasks and todos, dated relative to "today" so the list always has overdue, today,
// upcoming and undated items. Added only when the demo user has none, so reruns change nothing.
async function seedTasks(userId: string) {
  const [anyTask] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.userId, userId))
    .limit(1);
  if (anyTask) {
    console.log("Demo tasks already exist. Nothing to add.");
    return;
  }

  const [prefs] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  const today = getUserToday({
    timezone: prefs?.timezone ?? "UTC",
    startOfDay: prefs?.startOfDay ?? "06:00",
  });
  const day = (offset: number) => addDays(today, offset);
  const callNotesId = uuidv7();
  let order = 0;
  const next = () => (order += 1024);

  await db.insert(tasks).values([
    {
      userId,
      title: "Send invoice to studio",
      dueDate: day(-19),
      priority: "HIGH",
      sortOrder: next(),
    },
    { userId, title: "Renew domain", dueDate: day(-7), sortOrder: next() },
    {
      id: callNotesId,
      userId,
      title: "Prepare client call notes",
      emoji: "📞",
      status: "IN_PROGRESS",
      priority: "MEDIUM",
      dueDate: today,
      sortOrder: next(),
    },
    { userId, title: "Review design tokens", dueDate: today, priority: "LOW", sortOrder: next() },
    { userId, title: "Book dentist", dueDate: today, dueTime: "18:00", sortOrder: next() },
    { userId, title: "Draft Q4 roadmap", dueDate: day(1), priority: "HIGH", sortOrder: next() },
    {
      userId,
      title: "Weekly review",
      dueDate: day(3),
      recurrenceRule: "FREQ=WEEKLY;BYDAY=FR",
      sortOrder: next(),
    },
    { userId, title: "Choose a photographer", dueDate: day(8), sortOrder: next() },
    { userId, title: "Read the design tokens spec", sortOrder: next() },
    {
      userId,
      title: "Ship the first release",
      status: "DONE",
      completedAt: new Date(),
      sortOrder: next(),
    },
  ]);

  await db.insert(tasks).values([
    {
      userId,
      parentTaskId: callNotesId,
      title: "Pull last quarter numbers",
      status: "DONE",
      completedAt: new Date(),
      sortOrder: 1024,
    },
    { userId, parentTaskId: callNotesId, title: "Outline talking points", sortOrder: 2048 },
    { userId, parentTaskId: callNotesId, title: "Send agenda to Meera", sortOrder: 3072 },
  ]);

  let todoOrder = 0;
  const nextTodo = () => (todoOrder += 1024);
  await db.insert(todos).values([
    { userId, title: "Buy oat milk", sortOrder: nextTodo() },
    { userId, title: "Call mum", dueDate: today, sortOrder: nextTodo() },
    { userId, title: "Print boarding pass", dueDate: day(2), sortOrder: nextTodo() },
    { userId, title: "Return parcel", dueDate: day(-3), sortOrder: nextTodo() },
    { userId, title: "Water the plants", emoji: "🌱", sortOrder: nextTodo() },
    {
      userId,
      title: "Pay electricity bill",
      isComplete: true,
      completedAt: new Date(),
      sortOrder: nextTodo(),
    },
  ]);

  console.log("Added sample tasks and todos for the demo user.");
}
