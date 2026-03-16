import { useEffect, useMemo, useRef, useState } from "react";
import {
  DfaGraph,
  DfaState,
  DfaTransition,
  EMPTY_GRAPH,
  deleteStateCascade,
  normalizeSymbols,
  parseDfaTextToGraph,
  serializeGraphToDfaText,
  validateGraph,
} from "../lib/dfaEditor";

type Tool = "select" | "add-state" | "add-transition" | "delete";

type EditorBootConfig = {
  dfaText: string;
  alphabet: string[];
  problemId?: string;
};

type TransitionDialogState = {
  id: string | null;
  from: string;
  to: string;
  symbols: string;
};

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildArcPath(from: DfaState, to: DfaState, offsetIndex: number) {
  const stateRadius = 30;

  if (from.id === to.id) {
    const x = from.x;
    const y = from.y;
    const loopRadius = 26;
    const topY = y - stateRadius - 24;
    const leftX = x - loopRadius;
    const rightX = x + loopRadius;

    return {
      d: `M ${leftX} ${y - stateRadius + 1}
          C ${leftX} ${topY}, ${rightX} ${topY}, ${rightX} ${y - stateRadius + 1}`,
      labelX: x,
      labelY: topY - 10,
    };
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  const curveStrength = offsetIndex * 42;
  const centerX = (from.x + to.x) / 2;
  const centerY = (from.y + to.y) / 2;
  const controlX = centerX + px * curveStrength;
  const controlY = centerY + py * curveStrength;

  const projectPointToCircle = (pointX: number, pointY: number, centerState: DfaState) => {
    const vx = pointX - centerState.x;
    const vy = pointY - centerState.y;
    const vlen = Math.sqrt(vx * vx + vy * vy) || 1;
    return {
      x: centerState.x + (vx / vlen) * stateRadius,
      y: centerState.y + (vy / vlen) * stateRadius,
    };
  };

  const start = projectPointToCircle(controlX, controlY, from);
  const end = projectPointToCircle(controlX, controlY, to);

  const labelX = 0.25 * start.x + 0.5 * controlX + 0.25 * end.x;
  const labelY = 0.25 * start.y + 0.5 * controlY + 0.25 * end.y - 10;

  return {
    d: `M ${start.x} ${start.y} Q ${controlX} ${controlY} ${end.x} ${end.y}`,
    labelX,
    labelY,
  };
}

export default function DfaEditorPage() {
  const [graph, setGraph] = useState<DfaGraph>(EMPTY_GRAPH);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [alphabet, setAlphabet] = useState<string[]>([]);
  const [problemId, setProblemId] = useState<string>("");
  const [pendingTransitionFrom, setPendingTransitionFrom] = useState<string | null>(null);
  const [dialog, setDialog] = useState<TransitionDialogState | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<{ stateId: string; dx: number; dy: number } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const raw = window.localStorage.getItem("dfa-editor-boot-config");
    if (!raw) return;

    try {
      const config = JSON.parse(raw) as EditorBootConfig;
      setAlphabet(Array.isArray(config.alphabet) ? config.alphabet : []);
      setProblemId(config.problemId || "");
      setGraph(config.dfaText?.trim() ? parseDfaTextToGraph(config.dfaText) : EMPTY_GRAPH);
    } catch {
      setGraph(EMPTY_GRAPH);
    }
  }, []);

  useEffect(() => {
    function onMouseMove(ev: MouseEvent) {
      const drag = draggingRef.current;
      const canvas = canvasRef.current;
      if (!drag || !canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left - drag.dx;
      const y = ev.clientY - rect.top - drag.dy;

      setGraph((prev) => ({
        ...prev,
        states: prev.states.map((s) =>
          s.id === drag.stateId
            ? {
                ...s,
                x: Math.max(40, Math.min(rect.width - 40, x)),
                y: Math.max(40, Math.min(rect.height - 40, y)),
              }
            : s
        ),
      }));
    }

    function onMouseUp() {
      draggingRef.current = null;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const stateById = useMemo(() => new Map(graph.states.map((s) => [s.id, s])), [graph.states]);
  const selectedState = selectedStateId ? stateById.get(selectedStateId) ?? null : null;
  const validation = useMemo(() => validateGraph(graph, alphabet), [graph, alphabet]);

  function resetModes(nextTool: Tool) {
    setTool(nextTool);
    setPendingTransitionFrom(null);
  }

  function createStateAt(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const nextIndex = graph.states.length;
    const label = `q${nextIndex}`;

    setGraph((prev) => ({
      ...prev,
      states: [
        ...prev.states,
        {
          id: uid("state"),
          label,
          x: Math.max(40, Math.min(rect.width - 40, clientX - rect.left)),
          y: Math.max(40, Math.min(rect.height - 40, clientY - rect.top)),
          isStart: prev.states.length === 0,
          isAccept: false,
        },
      ],
    }));

    setTool("select");
  }

  function handleCanvasClick(ev: React.MouseEvent<HTMLDivElement>) {
    if (tool === "add-state") {
      createStateAt(ev.clientX, ev.clientY);
      return;
    }

    setSelectedStateId(null);
  }

  function startDragging(ev: React.MouseEvent<HTMLButtonElement>, state: DfaState) {
    if (tool !== "select") return;
    const rect = ev.currentTarget.getBoundingClientRect();
    draggingRef.current = {
      stateId: state.id,
      dx: ev.clientX - rect.left,
      dy: ev.clientY - rect.top,
    };
  }

  function updateStatePatch(stateId: string, patch: Partial<DfaState>) {
    setGraph((prev) => ({
      ...prev,
      states: prev.states.map((s) => {
        if (patch.isStart && s.id !== stateId) {
          return { ...s, isStart: false };
        }
        if (s.id !== stateId) return s;
        return { ...s, ...patch };
      }),
    }));
  }

  function openTransitionDialog(input: TransitionDialogState) {
    setDialog(input);
  }

  function handleStateClick(stateId: string) {
    if (tool === "delete") {
      setGraph((prev) => deleteStateCascade(prev, stateId));
      if (selectedStateId === stateId) setSelectedStateId(null);
      if (pendingTransitionFrom === stateId) setPendingTransitionFrom(null);
      return;
    }

    if (tool === "add-transition") {
      if (!pendingTransitionFrom) {
        setPendingTransitionFrom(stateId);
        return;
      }

      const fromState = stateById.get(pendingTransitionFrom);
      const toState = stateById.get(stateId);
      if (!fromState || !toState) return;

      openTransitionDialog({
        id: null,
        from: fromState.id,
        to: toState.id,
        symbols: alphabet[0] || "",
      });
      setPendingTransitionFrom(null);
      return;
    }

    setSelectedStateId(stateId);
  }

  function upsertTransition() {
    if (!dialog) return;
    const symbols = normalizeSymbols(dialog.symbols);
    if (symbols.length === 0) {
      setErrors(["A transition must have at least one symbol."]);
      return;
    }

    setGraph((prev) => {
      if (dialog.id) {
        return {
          ...prev,
          transitions: prev.transitions.map((t) =>
            t.id === dialog.id
              ? { ...t, from: dialog.from, to: dialog.to, symbols }
              : t
          ),
        };
      }

      return {
        ...prev,
        transitions: [
          ...prev.transitions,
          {
            id: uid("transition"),
            from: dialog.from,
            to: dialog.to,
            symbols,
          },
        ],
      };
    });

    setDialog(null);
    setTool("select");
    setErrors([]);
  }

  function deleteTransition(transitionId: string) {
    setGraph((prev) => ({
      ...prev,
      transitions: prev.transitions.filter((t) => t.id !== transitionId),
    }));
  }

  function saveAndClose() {
    try {
      const serialized = serializeGraphToDfaText(graph, alphabet);
      if (window.opener) {
        window.opener.postMessage(
          {
            type: "dfa-editor-save",
            payload: serialized,
          },
          window.location.origin
        );
      }
      window.close();
    } catch (err: any) {
      setErrors(String(err?.message || err).split("\n"));
    }
  }

  const transitionOffsets = useMemo(() => {
    const map = new Map<string, number>();
    for (const tr of graph.transitions) {
      if (tr.from === tr.to) {
        map.set(tr.id, 0);
        continue;
      }
      const direct = `${tr.from}__${tr.to}`;
      const reverse = `${tr.to}__${tr.from}`;
      map.set(tr.id, graph.transitions.some((x) => x.from === tr.to && x.to === tr.from) ? (direct < reverse ? 1 : -1) : 0);
    }
    return map;
  }, [graph.transitions]);

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <h1>DFA Editor {problemId ? <span className="muted">for {problemId}</span> : null}</h1>
          <div className="helpText">
            Alphabet: <span className="kbd">{alphabet.length ? `{${alphabet.join(", ")}}` : "not found"}</span>
          </div>
        </div>

        <div className="toolbar">
          <button className={tool === "select" ? "button" : "button ghost"} onClick={() => resetModes("select")}>Select</button>
          <button className={tool === "add-state" ? "button" : "button ghost"} onClick={() => resetModes("add-state")}>+ State</button>
          <button className={tool === "add-transition" ? "button" : "button ghost"} onClick={() => resetModes("add-transition")}>+ Transition</button>
          <button className={tool === "delete" ? "button" : "button ghost"} onClick={() => resetModes("delete")}>X Delete</button>
          <button className="button" onClick={saveAndClose}>Save</button>
        </div>
      </div>

      <div className="layout">
        <div className="panel canvasPanel">
          <div className="canvasHelp">
            {tool === "add-state" && "Click on the canvas to create a new state."}
            {tool === "add-transition" && !pendingTransitionFrom && "Select the source state for the transition."}
            {tool === "add-transition" && pendingTransitionFrom && "Now select the destination state."}
            {tool === "delete" && "Click a state or transition to delete it."}
            {tool === "select" && "You can drag states, select a state, or click a transition to edit it."}
          </div>

          <div ref={canvasRef} className="canvas" onClick={handleCanvasClick}>
            <svg className="svg">
              <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto">
                  <polygon points="0 0, 10 4, 0 8" fill="currentColor" />
                </marker>
              </defs>

              {graph.transitions.map((tr) => {
                const from = stateById.get(tr.from);
                const to = stateById.get(tr.to);
                if (!from || !to) return null;
                const offset = transitionOffsets.get(tr.id) ?? 0;
                const pathData = buildArcPath(from, to, offset);

                return (
                  <g
                    key={tr.id}
                    className="edgeGroup"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      if (tool === "delete") {
                        deleteTransition(tr.id);
                        return;
                      }
                      openTransitionDialog({
                        id: tr.id,
                        from: tr.from,
                        to: tr.to,
                        symbols: tr.symbols.join(", "),
                      });
                    }}
                  >
                    <path d={pathData.d} className="edgePath" markerEnd="url(#arrowhead)" />
                    <text x={pathData.labelX} y={pathData.labelY} textAnchor="middle" className="edgeLabel">
                      {tr.symbols.join(",")}
                    </text>
                  </g>
                );
              })}
            </svg>

            {graph.states.map((state) => (
              <button
                key={state.id}
                className={`state ${state.isAccept ? "accept" : ""} ${state.isStart ? "start" : ""} ${selectedStateId === state.id ? "selected" : ""}`}
                style={{ left: state.x - 30, top: state.y - 30 }}
                onMouseDown={(ev) => startDragging(ev, state)}
                onClick={(ev) => {
                  ev.stopPropagation();
                  handleStateClick(state.id);
                }}
                title={state.label}
              >
                <span>{state.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sideCol">
          <div className="panel sidePanel">
            <h2>State properties</h2>
            {!selectedState ? (
              <div className="helpText">Select a state to change its label, initial flag, or accepting flag.</div>
            ) : (
              <div className="formCol">
                <label>
                  <span>Label</span>
                  <input
                    value={selectedState.label}
                    onChange={(ev) => updateStatePatch(selectedState.id, { label: ev.target.value })}
                  />
                </label>

                <label className="checkRow">
                  <input
                    type="checkbox"
                    checked={selectedState.isStart}
                    onChange={(ev) => updateStatePatch(selectedState.id, { isStart: ev.target.checked })}
                  />
                  <span>Initial state</span>
                </label>

                <label className="checkRow">
                  <input
                    type="checkbox"
                    checked={selectedState.isAccept}
                    onChange={(ev) => updateStatePatch(selectedState.id, { isAccept: ev.target.checked })}
                  />
                  <span>Accepting state</span>
                </label>
              </div>
            )}
          </div>

          <div className="panel sidePanel">
            <h2>Validation</h2>
            {validation.ok ? (
              <div className="okBox">The DFA is valid with respect to the alphabet.</div>
            ) : (
              <ul className="errorList">
                {validation.errors.map((error, idx) => (
                  <li key={`${error}-${idx}`}>{error}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel sidePanel">
            <h2>Preview serialization</h2>
            <pre>
              {(() => {
                try {
                  return serializeGraphToDfaText(graph, alphabet);
                } catch {
                  return "Serialization will appear once the DFA becomes valid.";
                }
              })()}
            </pre>
          </div>
        </div>
      </div>

      {dialog && (
        <div className="modalBackdrop" onClick={() => setDialog(null)}>
          <div className="modal" onClick={(ev) => ev.stopPropagation()}>
            <h3>{dialog.id ? "Edit transition" : "New transition"}</h3>

            <label>
              <span>From</span>
              <select value={dialog.from} onChange={(ev) => setDialog({ ...dialog, from: ev.target.value })}>
                {graph.states.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>

            <label>
              <span>To</span>
              <select value={dialog.to} onChange={(ev) => setDialog({ ...dialog, to: ev.target.value })}>
                {graph.states.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Symbols (comma separated)</span>
              <input
                value={dialog.symbols}
                onChange={(ev) => setDialog({ ...dialog, symbols: ev.target.value })}
                placeholder={alphabet.join(",") || "a,b"}
              />
            </label>

            {errors.length > 0 && (
              <ul className="errorList compact">
                {errors.map((error, idx) => (
                  <li key={`${error}-${idx}`}>{error}</li>
                ))}
              </ul>
            )}

            <div className="modalButtons">
              {dialog.id && (
                <button
                  className="button ghost"
                  onClick={() => {
                    deleteTransition(dialog.id!);
                    setDialog(null);
                  }}
                >
                  Delete
                </button>
              )}
              <button className="button ghost" onClick={() => setDialog(null)}>Cancel</button>
              <button className="button" onClick={upsertTransition}>Apply</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .page {
          min-height: 100vh;
          padding: 20px;
          background: #0b1020;
          color: #eef2ff;
          font-family: Inter, system-ui, sans-serif;
        }
        .topbar {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        h1, h2, h3 {
          margin: 0 0 8px;
        }
        .muted, .helpText {
          color: #b7c2e0;
        }
        .toolbar {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .button {
          border: 1px solid #5b6b98;
          background: #3154ff;
          color: white;
          border-radius: 12px;
          padding: 10px 14px;
          cursor: pointer;
          font-weight: 600;
        }
        .button.ghost {
          background: transparent;
        }
        .layout {
          display: grid;
          grid-template-columns: 1.45fr 0.85fr;
          gap: 16px;
        }
        .panel {
          background: rgba(18, 25, 48, 0.95);
          border: 1px solid rgba(140, 160, 220, 0.25);
          border-radius: 18px;
          box-shadow: 0 18px 40px rgba(0, 0, 0, 0.25);
        }
        .canvasPanel {
          padding: 14px;
        }
        .canvasHelp {
          color: #cad5f2;
          margin-bottom: 10px;
          min-height: 22px;
        }
        .canvas {
          position: relative;
          height: 76vh;
          min-height: 640px;
          border-radius: 16px;
          overflow: hidden;
          background-image:
            linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px);
          background-size: 32px 32px;
          background-color: #0f1630;
        }
        .svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          color: #dbe7ff;
          pointer-events: none;
        }
        .edgeGroup {
          pointer-events: auto;
          cursor: pointer;
        }
        .edgePath {
          fill: none;
          stroke: currentColor;
          stroke-width: 2.2;
        }
        .edgeLabel {
          fill: #8ee3ff;
          font-size: 14px;
          font-weight: 700;
        }
        .state {
          position: absolute;
          width: 60px;
          height: 60px;
          border-radius: 999px;
          border: 2px solid #f7f8ff;
          background: #151d38;
          color: #f8fbff;
          display: flex;
          justify-content: center;
          align-items: center;
          cursor: pointer;
          user-select: none;
        }
        .state span {
          pointer-events: none;
          font-weight: 700;
        }
        .state.accept {
          box-shadow: inset 0 0 0 4px #151d38, inset 0 0 0 6px #f7f8ff;
        }
        .state.start::before {
          content: "";
          position: absolute;
          left: -24px;
          top: 50%;
          width: 16px;
          height: 2px;
          background: #f7f8ff;
          transform: translateY(-50%);
        }
        .state.start::after {
          content: "";
          position: absolute;
          left: -12px;
          top: 50%;
          border-top: 6px solid transparent;
          border-bottom: 6px solid transparent;
          border-left: 10px solid #f7f8ff;
          transform: translateY(-50%);
        }
        .state.selected {
          outline: 3px solid #ff6a8b;
          outline-offset: 3px;
        }
        .sideCol {
          display: grid;
          gap: 16px;
          align-content: start;
        }
        .sidePanel {
          padding: 16px;
        }
        .formCol {
          display: grid;
          gap: 12px;
        }
        label {
          display: grid;
          gap: 6px;
        }
        input, select {
          background: #0f1630;
          color: #eef2ff;
          border: 1px solid rgba(162, 183, 255, 0.3);
          border-radius: 12px;
          padding: 10px 12px;
        }
        .checkRow {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .checkRow input {
          width: auto;
        }
        .okBox {
          border: 1px solid #267b4b;
          background: rgba(38, 123, 75, 0.2);
          border-radius: 12px;
          padding: 10px 12px;
        }
        .errorList {
          margin: 0;
          padding-left: 18px;
          color: #ffb4c0;
        }
        .errorList.compact {
          margin-top: 8px;
        }
        pre {
          white-space: pre-wrap;
          margin: 0;
          background: #0f1630;
          padding: 12px;
          border-radius: 12px;
          overflow: auto;
        }
        .kbd {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 8px;
          background: rgba(255,255,255,0.08);
        }
        .modalBackdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.45);
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 16px;
        }
        .modal {
          width: min(460px, 100%);
          background: #121930;
          border-radius: 18px;
          padding: 18px;
          border: 1px solid rgba(162, 183, 255, 0.25);
          display: grid;
          gap: 12px;
        }
        .modalButtons {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          flex-wrap: wrap;
        }
        @media (max-width: 1100px) {
          .layout {
            grid-template-columns: 1fr;
          }
          .canvas {
            min-height: 520px;
          }
        }
      `}</style>
    </div>
  );
}
