import { ImageResponse } from "next/og";

export const alt = "Marpin — AI marketing copilot";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Branded social-share card (Open Graph / Twitter). Code-generated, on-brand. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#f2f1ec",
          padding: "72px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ display: "flex", width: 46, height: 46, borderRadius: 13, background: "#9A3D63" }} />
          <div style={{ fontSize: 36, fontWeight: 700, color: "#2b2722" }}>Marpin</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 22, letterSpacing: 5, color: "#9A3D63", fontWeight: 700 }}>
            AI MARKETING COPILOT
          </div>
          <div
            style={{
              fontSize: 66,
              color: "#2b2722",
              fontWeight: 600,
              lineHeight: 1.08,
              marginTop: 20,
              maxWidth: 920,
            }}
          >
            Drop your website. Get your next 10 growth moves.
          </div>
        </div>
        <div style={{ fontSize: 25, color: "#6b6359" }}>
          Market scans · competitor analysis · one-click campaigns
        </div>
      </div>
    ),
    { ...size },
  );
}
