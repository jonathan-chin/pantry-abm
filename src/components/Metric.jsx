// One number with a label under it.
export default function Metric({ value, label, color, title }) {
  return (
    <div className="metric" title={title}>
      <div className="num" style={{ color }}>{value}</div>
      <div className="lbl">{label}</div>
    </div>
  );
}
