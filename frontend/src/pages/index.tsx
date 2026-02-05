import Link from "next/link";
import { useMemo, useState } from "react";
import problems from "../data/problems.json";

type Diff = "All" | "Low" | "Medium" | "High";

function badgeClass(difficulty: string) {
  const d = difficulty.toLowerCase();
  if (d === "low") return "badge badgeLow";
  if (d === "medium") return "badge badgeMed";
  return "badge badgeHigh";
}

export default function Home() {
  const [filter, setFilter] = useState<Diff>("All");

  const filtered = useMemo(() => {
    if (filter === "All") return problems;
    return problems.filter((p: any) => p.difficulty === filter);
  }, [filter]);

  return (
    <>
      <div className="topbar">
        <div className="topbarInner">
          <Link className="brand" href="/">
            <img src="/logo.png" alt="Bada Bing!" />
            <div className="brandTitle">
              <b>Bada Bing!</b>
              <span>Regex & DFA practice</span>
            </div>
          </Link>

          <div className="pillRow">
            {(["All", "Low", "Medium", "High"] as Diff[]).map((d) => (
              <button
                key={d}
                className={`pill ${filter === d ? "pillActive" : ""}`}
                onClick={() => setFilter(d)}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="container">
        <div className="h1">Problems</div>
        <p className="sub">
          Solve each task either with a <span className="kbd">regex</span> or by writing the DFA transition function.
        </p>

        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>ID</th>
                <th>Title</th>
                <th style={{ width: 140 }}>Difficulty</th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p: any) => (
                <tr key={p.id} className="rowHover">
                  <td className="mono">{p.id}</td>
                  <td>
                    <Link className="rowLink" href={`/problems/${p.id}`}>
                      <b>{p.title}</b>
                    </Link>
                  </td>
                  <td>
                    <span className={badgeClass(p.difficulty)}>{p.difficulty}</span>
                  </td>
                  <td style={{ color: "var(--muted2)" }}>Open →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 14 }} className="small">
          Tip: Use <span className="kbd">&lt;eps&gt;</span> for the empty string in examples/tests.
        </div>
      </div>
    </>
  );
}
