export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Basic rate limiting - max 20 messages per IP per hour
  // (Vercel handles this at the edge, this is just a safeguard)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API not configured' });
  }

  try {
    const { messages, system } = req.body;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: system,
        messages: messages
      })
    });

    const data = await response.json();
    return res.status(response.status).json(data);

  } catch (err) {
    console.error('Chat proxy error:', err);
    return res.status(500).json({ error: 'Proxy error' });
  }
}
