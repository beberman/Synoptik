// Stands in for the `claude` program: prints what a headless run prints, as one JSON object a line.
// Behaviour comes from the task text: "fail", "hang" or anything else for a success.
const task = process.argv[process.argv.indexOf("--") + 1] ?? "";
const say = (o) => console.log(JSON.stringify(o));
say({ type: "system", subtype: "init", session_id: "tool-session-1" });
say({ type: "assistant", message: { content: [{ type: "text", text: "Looking at the file." }, { type: "tool_use", name: "Read", input: { file_path: "docs/a.yaml" } }] } });
if (task.includes("hang")) { setInterval(() => {}, 1000); process.on("SIGTERM", () => process.exit(143)); }
else if (task.includes("fail")) { say({ type: "result", subtype: "error_during_execution", is_error: true, result: "it went wrong" }); process.exit(1); }
else if (task.includes("crash")) { console.error("boom: out of credits"); process.exit(3); }
else { say({ type: "result", subtype: "success", is_error: false, result: "done" }); }
