"use client";



type ProofLinkProps = { label: string; url: string };

export function ProofLink({ label, url }: ProofLinkProps) {
  if (!url) return <div className="i"><div className="k">{label}</div><div className="v" style={{ color: "var(--muted)" }}>Not provided</div></div>;
  return (
    <div className="i"><div className="k">{label}</div><div className="v">
      <a href={url} target="_blank" rel="noreferrer">View</a>
    </div></div>
  );
}
