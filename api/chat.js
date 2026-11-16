// ============================================================
//  Gemini 小盒子 — Vercel 版
//  这个文件放在仓库的  api/chat.js  位置
//  key 从 Vercel 的环境变量里读，网页和别人都看不到
// ============================================================

const GEMINI_KEY = process.env.GEMINI_KEY ?? "";
const ACCESS_CODE = process.env.ACCESS_CODE ?? "";
const MODEL = process.env.MODEL ?? "gemini-2.5-flash";
const SYSTEM =
  process.env.SYSTEM ??
  "你是简洁、直接、说人话的中文助手。回答尽量短，不要客套。";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

async function callGemini(messages) {
  const contents = messages.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }));

  const payload = { contents };
  if (SYSTEM) payload.systemInstruction = { parts: [{ text: SYSTEM }] };

  const resp = await fetch(`${BASE}/${MODEL}:generateContent?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const msg = String((data && data.error && data.error.message) || `HTTP ${resp.status}`);
    if (/location is not supported/i.test(msg)) {
      throw new Error(
        "Google 判定这台服务器所在地区不支持（是服务器出口 IP 的问题，不是 key 的问题）",
      );
    }
    throw new Error(msg);
  }

  const parts =
    (data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts) || [];

  const text = parts.map((p) => p.text || "").join("").trim();
  return text || "（模型这次没返回内容）";
}

module.exports = async (req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "只用 POST" });
  }

  if (ACCESS_CODE && req.headers["x-access-code"] !== ACCESS_CODE) {
    return res.status(401).json({ error: "口令不对" });
  }

  if (!GEMINI_KEY) {
    return res.status(500).json({ error: "还没配 GEMINI_KEY 环境变量" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const msgs = (
    body && Array.isArray(body.messages) ? body.messages : []
  ).filter(
    (m) =>
      m &&
      (m.role === "user" || m.role === "model") &&
      typeof m.text === "string" &&
      m.text.trim() !== "",
  );

  if (msgs.length === 0) {
    return res.status(400).json({ error: "没有内容可发" });
  }

  try {
    const text = await callGemini(msgs.slice(-24));
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: (e && e.message) || String(e) });
  }
};
