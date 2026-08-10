// Scheduled trigger for the monthly rent reminder, calendar event reminders,
// and recurring expense reminders. Runs daily (see the cron in wrangler.toml)
// and asks the app to send today's reminders. All the real logic lives in the
// app's /api/cron/* endpoints; this worker only wakes them up.
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const headers = { Authorization: `Bearer ${env.CRON_SECRET}` };
        const base = 'https://mhdunnproperty.net/api/cron';

        try {
          const res = await fetch(`${base}/rent-due`, { method: 'POST', headers });
          const body = await res.text();
          console.log(`rent-due: HTTP ${res.status} ${body}`);
        } catch (err) {
          console.error(`rent-due: request failed: ${err && err.message ? err.message : err}`);
        }

        try {
          const res = await fetch(`${base}/calendar-reminders`, { method: 'POST', headers });
          const body = await res.text();
          console.log(`calendar-reminders: HTTP ${res.status} ${body}`);
        } catch (err) {
          console.error(`calendar-reminders: request failed: ${err && err.message ? err.message : err}`);
        }

        try {
          const res = await fetch(`${base}/expense-reminders`, { method: 'POST', headers });
          const body = await res.text();
          console.log(`expense-reminders: HTTP ${res.status} ${body}`);
        } catch (err) {
          console.error(`expense-reminders: request failed: ${err && err.message ? err.message : err}`);
        }

        try {
          const res = await fetch(`${base}/lease-expirations`, { method: 'POST', headers });
          const body = await res.text();
          console.log(`lease-expirations: HTTP ${res.status} ${body}`);
        } catch (err) {
          console.error(`lease-expirations: request failed: ${err && err.message ? err.message : err}`);
        }
      })()
    );
  },
};
