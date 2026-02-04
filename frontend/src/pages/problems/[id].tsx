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

  const problem = useMemo(() => problems.find((p: any) => p.id === id), [id]);

  const [mode, setMode] = useState<Mode>("regex");
  const [regex, setRegex] = useState("");
  const [dfa, setDfa] = useState(DFA_TEMPLATE);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  if (!problem) return <div style={{ padding: 30, fontFamily: "system-ui" }}>Loading…</div>;

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

  return (
    <div style={{ maxWidth: 1100, margin: "30px auto", fontFamily: "system-ui", padding: 16 }}>
      <button onClick={() => router.push("/")} style={{ marginBottom: 12 }}>
        ← Back
      </button>

      <h1 style={{ fontSize: 24, marginBottom: 8 }}>
        {problem.id}: {problem.title}
      </h1>
      <div style={{ whiteSpace: "pre-wrap", padding: 14, border: "1px solid #ddd", borderRadius: 8 }}>
        {problem.statement}
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 600 }}>Solve as:</div>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="radio" checked={mode === "regex"} onChange={() => setMode("regex")} />
          Regex
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="radio" checked={mode === "dfa"} onChange={() => setMode("dfa")} />
          DFA transitions
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          {mode === "regex" ? (
            <>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Your regex</div>
              <textarea
                value={regex}
                onChange={(e) => setRegex(e.target.value)}
                placeholder="e.g. (a|<eps>)b*   or   (a|ε)b*"
                style={{ width: "100%", height: 160, fontFamily: "monospace", fontSize: 14 }}
              />
              <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                For epsilon, use <code>{"<eps>"}</code> or <code>ε</code>.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Your DFA (transition function)</div>
              <textarea
                value={dfa}
                onChange={(e) => setDfa(e.target.value)}
                style={{ width: "100%", height: 240, fontFamily: "monospace", fontSize: 14 }}
              />
              <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                Format: <code>Start: q0</code>, <code>Accept: {"{q0, q2}"}</code>, lines like{" "}
                <code>(q0, a) -&gt; q1</code>. State names must be <code>q&lt;number&gt;</code>.
              </div>
            </>
          )}

          <button onClick={onRun} disabled={running} style={{ marginTop: 10, padding: "10px 14px" }}>
            {running ? "Running..." : "Run"}
          </button>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Examples</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 600, color: "green" }}>Should accept</div>
              <ul>{problem.accept.map((s: string) => <li key={s}><code>{s}</code></li>)}</ul>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: "crimson" }}>Should reject</div>
              <ul>{problem.reject.map((s: string) => <li key={s}><code>{s}</code></li>)}</ul>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#666" }}>
            Empty string is shown as <code>{"<eps>"}</code>.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Result</div>
        {!result && <div style={{ color: "#666" }}>No run yet.</div>}
        {result && (
          <div>
            {result.ok === true && (
              <div style={{ marginBottom: 8 }}>
                Verdict:{" "}
                <b style={{ color: result.pass ? "green" : "crimson" }}>{result.pass ? "PASS" : "FAIL"}</b>
              </div>
            )}
            {result.ok === false && (
              <div style={{ color: "crimson" }}>
                <b>Error:</b> {result.error}
              </div>
            )}
            {result.stage && <div style={{ color: "#666" }}>Stage: {result.stage}</div>}
            {result.stdout && (
              <>
                <div style={{ marginTop: 10, fontWeight: 600 }}>stdout</div>
                <pre style={{ background: "#fafafa", padding: 10, overflowX: "auto" }}>{result.stdout}</pre>
              </>
            )}
            {result.stderr && (
              <>
                <div style={{ marginTop: 10, fontWeight: 600 }}>stderr</div>
                <pre style={{ background: "#fafafa", padding: 10, overflowX: "auto" }}>{result.stderr}</pre>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
