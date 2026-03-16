export type DfaState = {
  id: string;
  label: string;
  x: number;
  y: number;
  isStart: boolean;
  isAccept: boolean;
};

export type DfaTransition = {
  id: string;
  from: string;
  to: string;
  symbols: string[];
};

export type DfaGraph = {
  states: DfaState[];
  transitions: DfaTransition[];
};

export type DfaValidationResult = {
  ok: boolean;
  errors: string[];
};

export const EMPTY_GRAPH: DfaGraph = {
  states: [],
  transitions: [],
};

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

export function normalizeSymbols(input: string[] | string): string[] {
  const raw = Array.isArray(input) ? input.join(",") : input;
  return uniq(
    raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

export function extractAlphabet(problemStatement?: string | null): string[] {
  if (!problemStatement) return [];

  const braceMatch = problemStatement.match(/alphabet\s*\{([^}]+)\}/i);
  if (braceMatch) {
    return uniq(
      braceMatch[1]
        .split(",")
        .map((x) => x.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean)
    );
  }

  return [];
}

export function parseDfaTextToGraph(text: string): DfaGraph {
  const cleanText = text.replace(/\r/g, "");
  const lines = cleanText
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  if (lines.length === 0) return EMPTY_GRAPH;

  const statesByLabel = new Map<string, DfaState>();
  const transitionsMap = new Map<string, DfaTransition>();

  const ensureState = (label: string): DfaState => {
    const normalized = label.trim();
    const existing = statesByLabel.get(normalized);
    if (existing) return existing;

    const idx = statesByLabel.size;
    const next: DfaState = {
      id: `state-${idx + 1}`,
      label: normalized,
      x: 140 + (idx % 4) * 170,
      y: 120 + Math.floor(idx / 4) * 140,
      isStart: false,
      isAccept: false,
    };
    statesByLabel.set(normalized, next);
    return next;
  };

  for (const line of lines) {
    if (/^Start:/i.test(line)) {
      const m = line.match(/^Start:\s*(.+)$/i);
      if (m?.[1]) ensureState(m[1]).isStart = true;
      continue;
    }

    if (/^Accept:/i.test(line)) {
      const m = line.match(/^Accept:\s*\{(.*)\}$/i);
      if (m) {
        m[1]
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
          .forEach((label) => {
            ensureState(label).isAccept = true;
          });
      }
      continue;
    }

    const m = line.match(/^\(([^,]+),\s*([^)]+)\)\s*->\s*(.+)$/);
    if (!m) continue;

    const from = ensureState(m[1]);
    const symbol = m[2].trim();
    const to = ensureState(m[3]);
    const key = `${from.id}__${to.id}`;

    if (transitionsMap.has(key)) {
      const existing = transitionsMap.get(key)!;
      existing.symbols = normalizeSymbols([...existing.symbols, symbol]);
    } else {
      transitionsMap.set(key, {
        id: `transition-${transitionsMap.size + 1}`,
        from: from.id,
        to: to.id,
        symbols: [symbol],
      });
    }
  }

  return {
    states: [...statesByLabel.values()],
    transitions: [...transitionsMap.values()],
  };
}

export function validateGraph(graph: DfaGraph, alphabet: string[]): DfaValidationResult {
  const errors: string[] = [];
  const trimmedAlphabet = uniq(alphabet.map((x) => x.trim()).filter(Boolean));

  if (graph.states.length === 0) {
    errors.push("There are no states.");
  }

  const starts = graph.states.filter((s) => s.isStart);
  if (starts.length !== 1) {
    errors.push("The DFA must have exactly one initial state.");
  }

  const labelSet = new Set<string>();
  for (const state of graph.states) {
    const label = state.label.trim();
    if (!label) {
      errors.push("There is a state without a name.");
      continue;
    }
    if (labelSet.has(label)) {
      errors.push(`There are two states with the same name: ${label}`);
    }
    labelSet.add(label);
  }

  const stateById = new Map(graph.states.map((s) => [s.id, s]));
  const transitionMap = new Map<string, string>();

  for (const tr of graph.transitions) {
    const from = stateById.get(tr.from);
    const to = stateById.get(tr.to);

    if (!from || !to) {
      errors.push("There is a transition pointing to a non-existent state.");
      continue;
    }

    const symbols = normalizeSymbols(tr.symbols);
    if (symbols.length === 0) {
      errors.push(`The transition ${from.label} → ${to.label} has no symbols.`);
      continue;
    }

    for (const symbol of symbols) {
      if (trimmedAlphabet.length > 0 && !trimmedAlphabet.includes(symbol)) {
        errors.push(`The symbol '${symbol}' does not belong to the alphabet {${trimmedAlphabet.join(", ")}}.`);
      }

      const key = `${from.id}__${symbol}`;
      if (transitionMap.has(key) && transitionMap.get(key) !== to.id) {
        errors.push(
          `Non-determinism: from state ${from.label} with symbol '${symbol}' there are multiple outgoing transitions.`
        );
      } else {
        transitionMap.set(key, to.id);
      }
    }
  }

  if (trimmedAlphabet.length > 0) {
    for (const state of graph.states) {
      for (const symbol of trimmedAlphabet) {
        const key = `${state.id}__${symbol}`;
        if (!transitionMap.has(key)) {
          errors.push(`Missing transition from ${state.label} with symbol '${symbol}'.`);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function serializeGraphToDfaText(graph: DfaGraph, alphabet: string[]): string {
  const validation = validateGraph(graph, alphabet);
  if (!validation.ok) {
    throw new Error(validation.errors.join("\n"));
  }

  const start = graph.states.find((s) => s.isStart)!;
  const accepts = graph.states.filter((s) => s.isAccept).map((s) => s.label.trim());
  const stateById = new Map(graph.states.map((s) => [s.id, s]));

  const transitionLines: string[] = [];
  for (const tr of graph.transitions) {
    const from = stateById.get(tr.from);
    const to = stateById.get(tr.to);
    if (!from || !to) continue;

    for (const symbol of normalizeSymbols(tr.symbols)) {
      transitionLines.push(`(${from.label.trim()}, ${symbol}) -> ${to.label.trim()}`);
    }
  }

  transitionLines.sort((a, b) => a.localeCompare(b));

  return [
    `Start: ${start.label.trim()}`,
    `Accept: {${accepts.join(", ")}}`,
    ...transitionLines,
  ].join("\n");
}

export function deleteStateCascade(graph: DfaGraph, stateId: string): DfaGraph {
  return {
    states: graph.states.filter((s) => s.id !== stateId),
    transitions: graph.transitions.filter((t) => t.from !== stateId && t.to !== stateId),
  };
}
