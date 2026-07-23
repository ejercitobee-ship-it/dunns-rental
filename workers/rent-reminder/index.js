// Scheduled trigger for the monthly rent reminder. Runs daily (see the cron in
// wrangler.toml) and asks the app to send today's reminder. All the real logic
// (is today the due day, has it already sent this month, who gets it) lives in
// the app's /api/cron/rent-due endpoint; this worker only wakes it up.
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          const res = await fetch('https://mhdunnproperty.net/api/cron/rent-due', {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
          });
          const body = await res.text();
          console.log(`rent-due: HTTP ${res.status} ${body}`);
        } catch (err) {
          console.error(`rent-due: request failed: ${err && err.message ? err.message : err}`);
        }
      })()
    );
  },
};
