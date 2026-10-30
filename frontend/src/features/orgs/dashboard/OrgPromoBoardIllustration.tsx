/** Lightweight board preview for the org dashboard promo (CSS-only, scoped blue). */
export function OrgPromoBoardIllustration() {
  return (
    <div
      className="hidden w-full max-w-[220px] shrink-0 rotate-[-2deg] rounded-lg border border-[var(--org-dash-border)] bg-[var(--org-dash-surface)] p-2 shadow-md sm:block"
      aria-hidden
    >
      <div className="mb-2 flex gap-1">
        <span className="size-1.5 rounded-full bg-[#ff5f57]" />
        <span className="size-1.5 rounded-full bg-[#febc2e]" />
        <span className="size-1.5 rounded-full bg-[#28c840]" />
      </div>
      <div className="grid grid-cols-3 gap-1">
        {['To do', 'Doing', 'Done'].map((col) => (
          <div key={col} className="rounded bg-[var(--org-dash-bg)] p-1">
            <p className="text-[8px] font-semibold uppercase text-[var(--org-dash-muted)]">{col}</p>
            <div className="mt-1 h-6 rounded border border-[var(--org-dash-border)] bg-white" />
          </div>
        ))}
      </div>
    </div>
  );
}
