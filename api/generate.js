// This file runs on Vercel's server, NOT in the browser.
// Your API key stays hidden here — never put it in index.html.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { question, subject } = req.body;

  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Missing question' });
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'Server not configured: missing GEMINI_API_KEY' });
  }

  // Primary model: 3.6 Flash — better reasoning depth for harder problems.
  // Listed as Free Tier Standard usage per Google's pricing docs, though it may
  // have tighter rate limits than Flash-Lite.
  // Falls back to 3.5 Flash-Lite automatically if 3.6 fails (rate limit, quota, etc.)
  // — keeps the site working even if 3.6's free-tier behaves inconsistently.
  const PRIMARY_MODEL = 'gemini-3.6-flash';
  const FALLBACK_MODEL = 'gemini-3.5-flash-lite';

  const systemPrompt = `You are a ${subject} visualization generator for high school students. Students will often type SHORT, vague queries (e.g. "screw gauge", "projectile motion", "explain SHM") rather than detailed specifications. Your job is to infer a complete, pedagogically useful visualization from minimal input.

When given a short or vague topic:
- Infer sensible default parameters yourself (e.g. for "projectile motion" assume a reasonable initial speed and angle like 25 m/s at 45°; for "screw gauge" assume standard pitch 0.5mm, 50 divisions; for "SHM" assume a mass-spring system with reasonable default mass/k that produces a slow, clearly visible oscillation — NOT a fast blur).
- Always include the standard, most pedagogically important version of the concept first, even if the student didn't specify exact numbers.
- Always include sliders/controls so the student can then explore variations themselves, even though you chose sensible defaults to start.

When given a detailed or specific query, follow the specifics given instead of inferring defaults.

Output ONLY a single self-contained HTML file with inline CSS and JavaScript using the Canvas API. Do not use any external libraries or CDN links.

Rules:
- Output must start with <!DOCTYPE html> and be a complete, runnable file.
- Use the <canvas> element for all drawing/animation.
- Include interactive controls (sliders, buttons, or input fields) so students can manipulate the concept after seeing the default view.
- Add clear on-canvas labels for key parts/values (numbers, units, scale markings).
- Include a short (2-3 sentence) explanation of the concept rendered as HTML text below the canvas.
- Choose default values that make the animation clearly visible and not too fast/subtle to see (e.g. avoid high-frequency oscillations or off-screen trajectories as defaults).
- Focus on clearly visualizing the SETUP and behavior of the concept. If exact numeric answers are uncertain, prioritize a qualitatively correct, clearly labeled interactive diagram over a possibly-wrong precise derivation.
- Code should be clean and commented.
- Do not include any text or explanation outside the HTML file itself — output raw code only, no markdown fences.`;

  async function callModel(modelId) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: question }] }],
          generationConfig: { temperature: 0.7 }
        })
      }
    );

    if (!response.ok) {
      const errBody = await response.text();
      const err = new Error(errBody);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    const html = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!html) {
      throw new Error('No content returned from model');
    }
    return html;
  }

  try {
    let html;
    let usedModel = PRIMARY_MODEL;
    try {
      html = await callModel(PRIMARY_MODEL);
    } catch (primaryErr) {
      // Fall back on rate limit (429), quota/billing issues (403), or server errors (5xx)
      console.warn(`Primary model ${PRIMARY_MODEL} failed, falling back to ${FALLBACK_MODEL}:`, primaryErr.message);
      usedModel = FALLBACK_MODEL;
      html = await callModel(FALLBACK_MODEL);
    }

    return res.status(200).json({ html, model: usedModel });
  } catch (err) {
    return res.status(502).json({ error: 'Both models failed: ' + err.message });
  }
}
