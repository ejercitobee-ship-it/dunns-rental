import { betterAuth } from 'better-auth';
import { d1Adapter } from 'better-auth/adapters/d1';

export const auth = (db: D1Database) => betterAuth({
  database: d1Adapter(db),
  secret: process.env.BETTER_AUTH_SECRET || 'your-secret-key-change-in-production',
  baseURL: process.env.BETTER_AUTH_URL || 'https://dunnrentalmanagement.pages.dev',
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },
  advanced: {
    cookiePrefix: 'dunns-rental',
    generateId: () => crypto.randomUUID(),
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user, context) => {
          // Check if this is the first user
          const db = context.db as D1Database;
          const userCount = await db.prepare('SELECT COUNT(*) as count FROM user').first('count');
          
          // If this is the first user, make them super_admin
          if (userCount === 1) {
            await db.prepare(
              'INSERT INTO user_roles (id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, unixepoch(), unixepoch())'
            ).bind(crypto.randomUUID(), user.id, 'super_admin').run();
          } else {
            // Otherwise assign default viewer role
            await db.prepare(
              'INSERT INTO user_roles (id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, unixepoch(), unixepoch())'
            ).bind(crypto.randomUUID(), user.id, 'viewer').run();
          }
        },
      },
    },
  },
});
