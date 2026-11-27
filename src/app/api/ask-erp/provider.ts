type Provider = "openai" | "qwen";
export type Mode = Provider | "direct";

const PO_NUMBER = /^[A-Za-z0-9][A-Za-z0-9./-]{0,63}$/;
export function validPO(value: string) {
  return PO_NUMBER.test(value) && /\d/.test(value);
}

export function poCandidates(question: string) {
  return [...new Set((question.match(/[A-Za-z0-9][A-Za-z0-9./-]*/g) ?? [])
    .map(token => token.replace(/[./-]+$/, "").replace(/^PO(?=\d)/i, ""))
    .filter(token => validPO(token) && (/\d{5,}/.test(token) || /[A-Za-z]/.test(token))))];
}

function providerConfig(provider: Provider) {
  if (provider === "openai") {
    return { key: process.env.OPENAI_API_KEY, model: process.env.ASK_ERP_OPENAI_MODEL || "gpt-5.4-mini",
      endpoint: "https://api.openai.com/v1/chat/completions" };
  }
  const workspace = process.env.ASK_ERP_QWEN_WORKSPACE?.trim();
  return {
    key: process.env.DASHSCOPE_API_KEY,
    model: process.env.ASK_ERP_QWEN_MODEL || "qwen3.7-flash",
    endpoint: workspace && /^[a-z0-9-]+$/i.test(workspace)
      ? `https://${workspace}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`
      : "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  };
}

export function availableModes(req: Request): Mode[] {
  const country = process.env.VERCEL === "1" ? req.headers.get("x-vercel-ip-country") : null;
  const modes: Mode[] = [];
  if (country === "KR" && providerConfig("openai").key) modes.push("openai");
  if (providerConfig("qwen").key) modes.push("qwen");
  return [...modes, "direct"];
}

export async function interpretPO(provider: Provider, question: string, candidates: string[]) {
  const { key, model, endpoint } = providerConfig(provider);
  try {
    // Replace document identifiers before sending the question to the provider.
    const masked = question.replace(/[A-Za-z0-9][A-Za-z0-9./-]*/g, token => {
      const index = candidates.indexOf(token.replace(/[./-]+$/, "").replace(/^PO(?=\d)/i, ""));
      return index < 0 ? token : `<PO_${index + 1}>`;
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: 'Classify one request for linked ERP purchase order documents. Return the requested placeholder number only (for <PO_1> return 1). Return 0 for ambiguous or unrelated requests. Never select a number that is absent.' },
          { role: "user", content: masked },
        ],
        ...(provider === "openai"
          ? { max_completion_tokens: 20, reasoning_effort: "none" }
          : { max_tokens: 20, enable_thinking: false }),
      }),
    });
    if (!response.ok) return null;
    const value = (await response.json()).choices?.[0]?.message?.content?.trim();
    if (value === "0") return "";
    return /^[1-9]\d*$/.test(value) ? candidates[Number(value) - 1] ?? null : null;
  } catch {
    return null;
  }
}
