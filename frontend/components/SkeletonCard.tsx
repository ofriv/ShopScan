/**
 * SkeletonCard — shimmer placeholder shown while a site is being scraped.
 * Now includes the diagonal sweep animation from the new design.
 */
export default function SkeletonCard() {
  return (
    <div className="skeleton">
      {/* Retailer row */}
      <div className="sk-row">
        <div className="sk sk-circle" />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="sk sk-line" style={{ width: "55%" }} />
          <div className="sk sk-line" style={{ width: "35%", height: 8 }} />
        </div>
        <div className="sk sk-line" style={{ width: 60, height: 18, borderRadius: 5 }} />
      </div>

      {/* Product title */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="sk sk-line" style={{ width: "100%" }} />
        <div className="sk sk-line" style={{ width: "80%" }} />
      </div>

      {/* Price */}
      <div className="sk sk-h" />

      {/* Comparison bar */}
      <div className="sk sk-line" style={{ width: "100%", height: 4 }} />

      {/* Rating */}
      <div className="sk-row">
        <div className="sk sk-line" style={{ width: 90 }} />
        <div className="sk sk-line" style={{ width: 60, height: 8 }} />
      </div>

      {/* Footer */}
      <div className="sk-foot">
        <div className="sk sk-line" style={{ width: 90 }} />
        <div className="sk sk-line" style={{ width: 60 }} />
      </div>
    </div>
  );
}
