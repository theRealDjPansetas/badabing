import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import problems from "../../data/problems.json";
import { run } from "../../lib/api";
import { extractAlphabet } from "../../lib/dfaEditor";

type Mode = "regex" | "dfa";

type RunResult = {
  ok?: boolean;
  pass?: boolean;
  stage?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
};

const DFA_TEMPLATE = `Start: q0
Accept: {q0}
(q0, a) -> q0
(q0, b) -> q0`;

export default function ProblemPage() {
  const router = useRouter();
  const { id } = router.query;

  const problem = useMemo(() => {
    if (typeof id !== "string") return undefined;
    return (problems as any[]).find((p) => p.id === id);
  }, [id]);

  const [mode, setMode] = useState<Mode>("regex");
  const [regex, setRegex] = useState("");
  const [dfa, setDfa] = useState(DFA_TEMPLATE);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  const alphabet = useMemo(() => extractAlphabet(problem?.statement), [problem?.statement]);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.type !== "dfa-editor-save") return;
      if (typeof ev.data?.payload !== "string") return;
      setMode("dfa");
      setDfa(ev.data.payload);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!router.isReady) return <div>Loading…</div>;
  if (!problem) return <div>Problem not found.</div>;

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

  function openDfaEditor() {
    const bootConfig = {
      dfaText: dfa,
      alphabet,
      problemId: problem.id,
    };

    window.localStorage.setItem("dfa-editor-boot-config", JSON.stringify(bootConfig));

    window.open(
      "/dfa-editor",
      `dfa-editor-${problem.id}`,
      "width=1400,height=900,menubar=no,toolbar=no,location=no,status=no"
    );
  }

  const verdict = result?.ok === true ? (result.pass ? "PASS" : "FAIL") : null;

  return (
    <>
      <div className="pageShell">
        <div className="card cardPad" style={{ marginBottom: 14 }}>
          <button className="button ghost" onClick={() => router.push("/")}>← Back</button>
          <h1 style={{ marginTop: 14, marginBottom: 8 }}>Bada Bing! {problem.id}</h1>
          <div className="small" style={{ marginBottom: 10 }}>
            Solve as:
            <label style={{ marginLeft: 12 }}>
              <input
                type="radio"
                checked={mode === "regex"}
                onChange={() => {
                  setMode("regex");
                  setDfa("");
                }}
              />{" "}
              Regex
            </label>
            <label style={{ marginLeft: 12 }}>
              <input
                type="radio"
                checked={mode === "dfa"}
                onChange={() => {
                  setMode("dfa");
                  setRegex("");
                  if (!dfa.trim()) setDfa(DFA_TEMPLATE);
                }}
              />{" "}
              DFA transitions
            </label>
          </div>

          <h2 style={{ marginBottom: 8 }}>{problem.title}</h2>
          <p style={{ marginTop: 0 }}>{problem.statement}</p>
          <div className="small">
            Parsed alphabet: <span className="kbd">{alphabet.length ? `{${alphabet.join(", ")}}` : "not found"}</span>
          </div>
        </div>

        <div className="grid2">
          <div className="card cardPad">
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Your solution</div>
            <div className="small" style={{ marginBottom: 10 }}>Mode: {mode}</div>

            {mode === "regex" ? (
              <>
                <textarea
                  className="editor"
                  value={regex}
                  onChange={(e) => setRegex(e.target.value)}
                  placeholder="e.g. (a|<eps>)b* or (a|ε)b*"
                />
                <div className="small" style={{ marginTop: 8 }}>
                  Epsilon: <span className="kbd">&lt;eps&gt;</span> or <span className="kbd">ε</span>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                  <button className="button" type="button" onClick={openDfaEditor}>
                    Open visual DFA editor
                  </button>
                </div>

                <textarea
                  className="editor"
                  value={dfa}
                  onChange={(e) => setDfa(e.target.value)}
                  style={{ minHeight: 260 }}
                />

                <div className="small" style={{ marginTop: 8 }}>
                  Το text αυτό παράγεται από τον visual editor και είναι ακριβώς αυτό που στέλνεται στο backend.
                </div>
                <div className="small" style={{ marginTop: 8 }}>
                  Format: <span className="kbd">Start: q0</span>, <span className="kbd">Accept: {"{q0, q2}"}</span>, <span className="kbd">(q0, a) -&gt; q1</span>
                </div>
              </>
            )}

            <div className="sep" />
            <button className="button" onClick={onRun} disabled={running}>
              {running ? "Running..." : "Run"} <span style={{ opacity: 0.85 }}>⚡</span>
            </button>
          </div>

          <div className="card cardPad">
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Examples</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div className="resultGood">Should accept</div>
                <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
                  {problem.accept.map((s: string) => (
                    <li key={s} className="mono"><code>{s}</code></li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="resultBad">Should reject</div>
                <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
                  {problem.reject.map((s: string) => (
                    <li key={s} className="mono"><code>{s}</code></li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="sep" />
            <div className="small">Empty string is shown as <span className="kbd">&lt;eps&gt;</span>.</div>
          </div>
        </div>

        <div style={{ marginTop: 14 }} className="card cardPad">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 800 }}>Result</div>
            {verdict && (
              <div>
                Verdict: <span className={verdict === "PASS" ? "resultGood" : "resultBad"} style={{ fontSize: 14 }}>{verdict}</span>
              </div>
            )}
          </div>

          {!result && <div className="small" style={{ marginTop: 8 }}>No run yet.</div>}

          {result?.ok === false && (
            <div style={{ marginTop: 10 }}>
              <div style={{ color: "var(--bad)" }}><b>Error:</b> {result.error || "Compilation failed."}</div>
              {result.stage && <div className="small" style={{ marginTop: 8 }}>Stage: <span className="kbd">{result.stage}</span></div>}
              {result.stdout && <><div style={{ marginTop: 12, fontWeight: 700 }}>stdout</div><pre>{result.stdout}</pre></>}
              {result.stderr && <><div style={{ marginTop: 12, fontWeight: 700 }}>stderr</div><pre>{result.stderr}</pre></>}
            </div>
          )}

          {result?.ok === true && (
            <>
              <div className="small" style={{ marginTop: 8 }}>Stage: <span className="kbd">{result.stage}</span></div>
              {result.stdout && <><div style={{ marginTop: 12, fontWeight: 700 }}>stdout</div><pre>{result.stdout}</pre></>}
              {result.stderr && <><div style={{ marginTop: 12, fontWeight: 700 }}>stderr</div><pre>{result.stderr}</pre></>}
            </>
          )}
        </div>
      </div>
    </>
  );
}
