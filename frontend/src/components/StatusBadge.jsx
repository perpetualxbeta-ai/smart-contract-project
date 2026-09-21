const STATE_META = {
  AWAITING_PAYMENT: { label: "Awaiting Payment", modifier: "amber" },
  FUNDED: { label: "Funded", modifier: "cyan" },
  COMPLETED: { label: "Completed", modifier: "green" },
  REFUNDED: { label: "Refunded", modifier: "pink" },
};

export default function StatusBadge({ stateLabel }) {
  const meta = STATE_META[stateLabel] || { label: "Unknown", modifier: "purple" };
  return (
    <div className={`status-badge status-badge--${meta.modifier}`}>
      <span className="status-badge__dot" />
      Status: {meta.label.toUpperCase()}
    </div>
  );
}
