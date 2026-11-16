// ============================================================
//  API Key 测试器 — Vercel 版
//  放在仓库的  api/test.js
//  作用：拿着你填的 base_url + key，替浏览器去试一次
//        （浏览器直接调会被 CORS 挡，所以需要这一层）
//  不记录、不保存任何 key
// ============================================================

function short(txt) {
  if (!txt) return "";
  const s = String(txt).replace(/\s+/g, " ").trim();
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}

function netErr(e) {
  const m = String((e && e.message) || e);
  if (/timeout|timed out|abort/i.test(m)) return "超时（20 秒没回应）";
  return m;
}

// 把各种失败翻译成人话
function classify(status, msg) {
  if (status === 0) return "连不上（超时，或者这条路被墙了）";
  if (status === 401) return "key 无效 / 未授权";
  if (status === 402) return "额度不足，需要充值";
  if (status === 403) return "被拒绝（IP 限制、地区限制，或已封禁）";
  if (status === 404) return "地址不对（检查 base_url 有没有写重 /v1）";
  if (status === 429) return "频率限制 / 额度用完了";
  if (status >= 500) return "站点自己挂了（5xx），不是你 key 的问题";
  if (/model/i.test(msg) && /not found|invalid|unknown/i.test(msg)) return "模型名不对";
  return "HTTP " + status;
}

module.exports = async (req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "只用 POST" });
  }

  const need = process.env.ACCESS_CODE || "";
  if (need && req.headers["x-access-code"] !== need) {
    return res.status(401).json({ error: "口令不对" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const base = String((body && body.base) || "").replace(/\/+$/, "");
  const key = String((body && body.key) || "").trim();
  const wantModel = String((body && body.model) || "").trim();

  if (!base || !key) {
    return res.status(400).json({ error: "接口地址和 key 都要填" });
  }
  if (!/^https?:\/\//i.test(base)) {
    return res.status(400).json({ error: "接口地址要以 http:// 或 https:// 开头" });
  }

  const started = Date.now();
  const auth = { authorization: "Bearer " + key };
  const timeout = () => AbortSignal.timeout(20000);

  // ---------- 第一步：拉模型列表 ----------
  let models = [];
  let modelsProblem = null;

  try {
    const r = await fetch(base + "/models", { headers: auth, signal: timeout() });
    const txt = await r.text();

    if (!r.ok) {
      modelsProblem = { status: r.status, note: classify(r.status, txt), detail: short(txt) };
    } else {
      try {
        const j = JSON.parse(txt);
        const list = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [];
        models = list.map((m) => m && (m.id || m.name)).filter(Boolean);
      } catch {
        modelsProblem = { status: r.status, note: "能连上，但返回的不是标准 JSON", detail: short(txt) };
      }
    }
  } catch (e) {
    modelsProblem = { status: 0, note: classify(0, ""), detail: netErr(e) };
  }

  // ---------- 第二步：真正生成一次 ----------
  const useModel = wantModel || models[0] || "gpt-3.5-turbo";

  let reply = null;
  let chatProblem = null;

  try {
    const r = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      signal: timeout(),
      body: JSON.stringify({
        model: useModel,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        max_tokens: 16,
      }),
    });

    const txt = await r.text();

    if (!r.ok) {
      chatProblem = { status: r.status, note: classify(r.status, txt), detail: short(txt) };
    } else {
      let j = null;
      try {
        j = JSON.parse(txt);
      } catch {}

      const choice = j && j.choices && j.choices[0];
      const content =
        (choice && choice.message && choice.message.content) ||
        (choice && choice.text) ||
        "";

      if (content) {
        reply = String(content).trim();
      } else {
        chatProblem = {
          status: r.status,
          note: "通了，但没解析出回复内容",
          detail: short(txt),
        };
      }
    }
  } catch (e) {
    chatProblem = { status: 0, note: classify(0, ""), detail: netErr(e) };
  }

  const latencyMs = Date.now() - started;
  const ok = !!reply;

  return res.status(200).json({
    ok,
    latencyMs,
    model: useModel,
    models,
    modelCount: models.length,
    reply,
    modelsProblem,
    chatProblem,
    // 一句话结论
    verdict: ok
      ? "可以用"
      : chatProblem
        ? chatProblem.note
        : modelsProblem
          ? modelsProblem.note
          : "未知原因失败",
  });
};
