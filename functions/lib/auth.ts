import { betterAuth } from 'better-auth';

interface Env {
  DB: D1Database;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
}

export const auth = (env: Env) => betterAuth({
  database: env.DB, // D1 binding is auto-detected!
  secret: env.BETTER_AUTH_SECRET || 'your-secret-key-change-in-production',
  baseURL: env.BETTER_AUTH_URL || 'https://dunnrentalmanagement.pages.dev',
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
