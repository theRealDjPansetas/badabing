import { useRouter } from "next/router";
import { useMemo, useState } from "react";
import problems from "../../data/problems.json";
import { run } from "../../lib/api";

type Mode = "regex" | "dfa";

const DFA_TEMPLATE = `Start: q0
Accept: {q0}

(q0, a) -> q0
(q0, b) -> q0
`;

export default function ProblemPage() {
  const router = useRouter();
const { id } = router.query;

const problem = useMemo(() => {
  if (typeof id !== "string") return undefined;
  return (problems as any[]).find((p) => p.id === id);
}, [id]);

if (!router.isReady) return <div className="container">Loading…</div>;
if (!problem) return <div className="container">Problem not found.</div>;

  const [mode, setMode] = useState<Mode>("regex");
  const [regex, setRegex] = useState("");
  const [dfa, setDfa] = useState(DFA_TEMPLATE);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function onRun() {
    setRunning(true);
    setResult(null);
    try {
      const payload =
        mode === "regex"
          ? { problemId: problem.id, mode: "regex", regex }
          : { problemId: problem.id, mode: "dfa", dfa };

      const data = await run(payload);
      setResult(data);
    } catch (e: any) {
      setResult({ ok: false, error: String(e?.message || e) });
    } finally {
      setRunning(false);
    }
  }

  const verdict = result?.ok === true ? (result.pass ? "PASS" : "FAIL") : null;

  return (
    <>
      <div className="topbar">
        <div className="topbarInner">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="button ghost" onClick={() => router.push("/")}>
              ← Back
            </button>
            <div className="brandTitle">
              <b>Bada Bing!</b>
              <span className="mono">{problem.id}</span>
            </div>
          </div>

          <div className="radioRow">
            <span style={{ fontWeight: 700, color: "var(--text)" }}>Solve as:</span>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="radio" checked={mode === "regex"} onChange={() => setMode("regex")} />
              Regex
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="radio" checked={mode === "dfa"} onChange={() => setMode("dfa")} />
              DFA transitions
            </label>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="h1">{problem.title}</div>

        <div className="card cardPad" style={{ marginBottom: 14 }}>
          <div style={{ whiteSpace: "pre-wrap", color: "var(--muted)" }}>{problem.statement}</div>
        </div>

        <div className="grid2">
          <div className="card cardPad">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontWeight: 800 }}>Your solution</div>
              <div className="small">Mode: <span className="kbd">{mode}</span></div>
            </div>

            {mode === "regex" ? (
              <>
                <textarea
                  className="editor"
                  value={regex}
                  onChange={(e) => setRegex(e.target.value)}
                  placeholder="e.g. (a|<eps>)b*   or   (a|ε)b*"
                />
                <div className="small" style={{ marginTop: 8 }}>
                  Epsilon: <span className="kbd">&lt;eps&gt;</span> or <span className="kbd">ε</span>
                </div>
              </>
            ) : (
              <>
                <textarea className="editor" value={dfa} onChange={(e) => setDfa(e.target.value)} style={{ minHeight: 260 }} />
                <div className="small" style={{ marginTop: 8 }}>
                  Format: <span className="kbd">Start: q0</span>, <span className="kbd">Accept: {"{q0, q2}"}</span>,{" "}
                  <span className="kbd">(q0, a) -&gt; q1</span>
                </div>
              </>
            )}

            <div className="sep" />

            <button className="button" onClick={onRun} disabled={running}>
              {running ? "Running..." : "Run"}
              <span style={{ opacity: 0.85 }}>⚡</span>
            </button>
          </div>

          <div className="card cardPad">
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Examples</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div className="resultGood">Should accept</div>
                <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
                  {problem.accept.map((s: string) => (
                    <li key={s} className="mono">
                      <code>{s}</code>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="resultBad">Should reject</div>
                <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
                  {problem.reject.map((s: string) => (
                    <li key={s} className="mono">
                      <code>{s}</code>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="sep" />
            <div className="small">
              Empty string is shown as <span className="kbd">&lt;eps&gt;</span>.
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14 }} className="card cardPad">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 800 }}>Result</div>
            {verdict && (
              <div>
                Verdict:{" "}
                <span className={verdict === "PASS" ? "resultGood" : "resultBad"} style={{ fontSize: 14 }}>
                  {verdict}
                </span>
              </div>
            )}
          </div>

          {!result && <div className="small" style={{ marginTop: 8 }}>No run yet.</div>}

          {result?.ok === false && (
            <div style={{ marginTop: 10, color: "var(--bad)" }}>
              <b>Error:</b> {result.error}
            </div>
          )}

          {result?.ok === true && (
            <>
              <div className="small" style={{ marginTop: 8 }}>Stage: <span className="kbd">{result.stage}</span></div>

              {result.stdout && (
                <>
                  <div style={{ marginTop: 12, fontWeight: 700 }}>stdout</div>
                  <pre>{result.stdout}</pre>
                </>
              )}

              {result.stderr && (
                <>
                  <div style={{ marginTop: 12, fontWeight: 700 }}>stderr</div>
                  <pre>{result.stderr}</pre>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
