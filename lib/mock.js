// Mock transcription: canned transcript with synthetic word timings.
// Used by the server in mock mode and by the app in Demo mode (no backend).
// Always marked simulated so it is never mistaken for a real measurement.

const MOCK_TEXT =
  'So um the main reason I think we should change the launch date is uh quality. ' +
  'If we ship in March we skip two rounds of testing. Basically that means more support tickets ' +
  'and a weaker first impression. I would rather launch in April with a product we are proud of.';

export function mockTranscription(durationHint) {
  const tokens = MOCK_TEXT.split(/\s+/);
  const duration = Number.isFinite(durationHint) && durationHint > 3 ? durationHint : 24;
  // Fixed, realistic pace (~150 words/min while speaking) regardless of the take's length;
  // the reported duration stretches to fit the sample if the take was shorter.
  const per = 0.4;
  let t = 0.6;
  const words = tokens.map((tok, i) => {
    const w = {
      word: tok.toLowerCase().replace(/[^a-z']/g, ''),
      display: tok,
      start: +t.toFixed(2),
      end: +(t + per * 0.85).toFixed(2),
      confidence: 0.99,
    };
    t += per;
    if (/[.]$/.test(tok) && i < tokens.length - 1) t += 1.3; // sentence pauses
    return w;
  });
  return {
    provider: 'mock',
    simulated: true,
    text: MOCK_TEXT,
    words,
    duration: Math.max(duration, +(t + 0.4).toFixed(2)),
    capabilities: { word_timestamps: true, disfluencies: true },
  };
}
