function truncate(address) {
  if (!address) return "—";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function AddressPill({ label, address, highlight }) {
  return (
    <div className={`address-pill${highlight ? " address-pill--you" : ""}`}>
      <span className="address-pill__label">{label}</span>
      <span className="address-pill__value" title={address}>
        {truncate(address)}
      </span>
      {highlight && <span className="address-pill__you-tag">YOU</span>}
    </div>
  );
}
