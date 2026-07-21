// The handyman portal home. Built out in slice 4 (available jobs, my jobs, and
// the claim / confirm-time / start / complete actions).
export function HandymanJobs() {
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Maintenance</p>
        <h1 className="font-display text-2xl text-ink mt-1">Jobs</h1>
        <p className="text-sm text-muted mt-1">Loading your jobs.</p>
      </div>
    </div>
  );
}
