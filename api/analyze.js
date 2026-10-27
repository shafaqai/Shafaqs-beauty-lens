// Serverless function: keeps the YouCam API key on the server (env var YOUCAM_API_KEY).
const BASE = "https://yce-api-01.makeupar.com/s2s/v2.0";
const CONCERNS = ["acne", "moisture", "oiliness", "pore"]; // 4 concerns = 9 units per run

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.YOUCAM_API_KEY;
  if (!key) return res.status(500).json({ error: "Server key not set" });
  const auth = { Authorization: "Bearer " + key, "Content-Type": "application/json" };
  try {
    const b64 = String((req.body || {}).image || "").split(",").pop();
    const buf = Buffer.from(b64, "base64");
    if (buf.length < 5000 || buf.length > 3000000) return res.status(400).json({ error: "Bad image size" });

    const f1 = await (await fetch(BASE + "/file", { method: "POST", headers: auth,
      body: JSON.stringify({ files: [{ content_type: "image/jpeg", file_name: "selfie.jpg", file_size: buf.length }] }) })).json();
    const file = f1.data.files[0];
    const up = await fetch(file.requests[0].url, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: buf });
    if (!up.ok) throw new Error("Upload failed");

    const t = await (await fetch(BASE + "/task/skin-analysis", { method: "POST", headers: auth,
      body: JSON.stringify({ src_file_id: file.file_id, dst_actions: CONCERNS, format: "json" }) })).json();
    if (t.status !== 200) return res.status(400).json({ error: t.error_code || t.error || "Task failed" });
    const id = t.data.task_id;

    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const p = await (await fetch(BASE + "/task/skin-analysis/" + id, { headers: auth })).json();
      const d = p.data || {};
      if (d.task_status === "success") {
        const out = (d.results && d.results.output) || [];
        const scores = {};
        (Array.isArray(out) ? out : Object.values(out)).forEach(o => { if (o && o.type) scores[o.type] = o.ui_score; });
        return res.status(200).json({ scores });
      }
      if (d.task_status === "error") return res.status(400).json({ error: d.error || "Analysis error (try a clearer, front-facing selfie)" });
    }
    res.status(504).json({ error: "Timed out, please try again" });
  } catch (e) { res.status(500).json({ error: "Server error" }); }
};
