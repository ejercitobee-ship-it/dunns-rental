// Scheduled trigger for the monthly database backup. Runs on the 1st of
// every month (see the cron in wrangler.toml) and asks the app to export
// all tables to a JSON file in Google Drive. All the real logic lives in
// the app's /api/cron/backup endpoint; this worker only wakes it up.
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          const res = await fetch('https://mhdunnproperty.net/api/cron/backup', {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
          });
          const body = await res.text();
          console.log(`backup: HTTP ${res.status} ${body}`);
        } catch (err) {
          console.error(`backup: request failed: ${err && err.message ? err.message : err}`);
        }
      })()
    );
  },
};
