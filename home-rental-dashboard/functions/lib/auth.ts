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
});
