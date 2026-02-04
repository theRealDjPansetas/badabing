import Link from "next/link";
import problems from "../data/problems.json";

export default function Home() {
  return (
    <div style={{ maxWidth: 900, margin: "40px auto", fontFamily: "system-ui", padding: 16 }}>
      <h1 style={{ fontSize: 28, marginBottom: 16 }}>Regex Problems</h1>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
        {problems.map((p) => (
          <Link key={p.id} href={`/problems/${p.id}`} style={{ textDecoration: "none", color: "inherit" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: 14, borderBottom: "1px solid #eee" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{p.id}: {p.title}</div>
                <div style={{ fontSize: 13, color: "#666" }}>{p.difficulty}</div>
              </div>
              <div style={{ fontSize: 13, color: "#666" }}>Open →</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
