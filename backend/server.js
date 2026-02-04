const express = require("express");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();
app.use(express.json({ limit: "64kb" }));

const PORT = process.env.PORT || 8080;

function runCmd(cmd, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));

    const timer = setTimeout(() => {
      stderr += `\n[server] timeout after ${timeoutMs}ms`;
      p.kill("SIGKILL");
    }, timeoutMs);

    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function safeProblemId(problemId) {
  return /^P\d{3}$/.test(problemId);
}

function normalizeAlphabetLine(line) {
  // from ref line2 like: "a b 0 1" or "a,b,0,1" or "ab01" -> "ab01"
  let s = "";
  for (const ch of line) {
    if (ch === "\n" || ch === "\r") continue;
    if (ch === " " || ch === "\t" || ch === "," || ch === ";") continue;
    s += ch;
  }
  if (!s) throw new Error("Empty alphabet in ref.txt");
  return s;
}

app.get("/health", (_req, res) => res.json({ ok: true }));

/*
POST /api/run
body:
  {
    problemId: "P001",
    mode: "regex" | "dfa",
    regex?: "...",
    dfa?: "Start: q0\nAccept: {...}\n(q0,a)->q1\n..."
  }
*/
app.post("/api/run", async (req, res) => {
  try {
    const { problemId, mode } = req.body || {};
    if (!safeProblemId(problemId)) {
      return res.status(400).json({ ok: false, error: "Invalid problemId" });
    }
    const runMode = mode === "dfa" ? "dfa" : "regex";

    const probDir = path.join(__dirname, "problems", problemId);
    const refPath = path.join(probDir, "ref.txt");
    const testsPath = path.join(probDir, "tests.txt");

    const refTxt = await fsp.readFile(refPath, "utf-8");
    const refLines = refTxt.split(/\r?\n/);
    if (refLines.length < 2) throw new Error("Bad ref.txt format (need 2 lines)");

    const alphabetLine = refLines[1];
    const alphabetString = normalizeAlphabetLine(alphabetLine);

    const runId = crypto.randomBytes(8).toString("hex");
    const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), `run-${runId}-`));

    const refCopyPath = path.join(workDir, "ref.txt");
    const testsCopyPath = path.join(workDir, "tests.txt");
    await fsp.writeFile(refCopyPath, refTxt, "utf-8");
    await fsp.copyFile(testsPath, testsCopyPath);

    const mindfa = path.join(__dirname, "bin", "regex2mindfa");
    const checker = path.join(__dirname, "bin", "dfa_checker");
    const dfa2table = path.join(__dirname, "bin", "dfa2table");

    const timeoutMs = 1500;

    // Compile reference DFA always (keeps reference hidden server-side)
    const r1 = await runCmd(mindfa, [refCopyPath, path.join(workDir, "ref.dfa")], { cwd: workDir, timeoutMs });
    if (r1.code !== 0) {
      return res.status(200).json({ ok: false, stage: "compile_ref", ...r1 });
    }

    // Build user DFA depending on mode
    if (runMode === "regex") {
      const { regex } = req.body || {};
      if (typeof regex !== "string" || regex.length < 1 || regex.length > 4000) {
        return res.status(400).json({ ok: false, error: "Invalid regex length" });
      }
      const userPath = path.join(workDir, "user.txt");
      await fsp.writeFile(userPath, `${regex}\n${alphabetLine}\n`, "utf-8");

      const r2 = await runCmd(mindfa, [userPath, path.join(workDir, "user.dfa")], { cwd: workDir, timeoutMs });
      if (r2.code !== 0) {
        return res.status(200).json({ ok: false, stage: "compile_user_regex", ...r2 });
      }
    } else {
      const { dfa } = req.body || {};
      if (typeof dfa !== "string" || dfa.length < 1 || dfa.length > 20000) {
        return res.status(400).json({ ok: false, error: "Invalid DFA spec length" });
      }
      const userSpecPath = path.join(workDir, "user_dfa.txt");
      await fsp.writeFile(userSpecPath, dfa, "utf-8");

      const r2 = await runCmd(dfa2table, [alphabetString, userSpecPath, path.join(workDir, "user.dfa")], {
        cwd: workDir,
        timeoutMs
      });
      if (r2.code !== 0) {
        return res.status(200).json({ ok: false, stage: "compile_user_dfa", ...r2 });
      }
    }

    // Compare behavior on tests
    const r3 = await runCmd(checker, [path.join(workDir, "ref.dfa"), path.join(workDir, "user.dfa"), testsCopyPath], {
      cwd: workDir,
      timeoutMs
    });

    // cleanup best-effort
    fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});

    const pass = r3.code === 0;
    return res.status(200).json({
      ok: true,
      mode: runMode,
      pass,
      stage: "check",
      stdout: r3.stdout,
      stderr: r3.stderr
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.listen(PORT, () => console.log(`Backend listening on :${PORT}`));
