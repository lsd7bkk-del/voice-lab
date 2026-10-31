// Articulation prompts (spec §9: 12+, original content).
// seconds = target answer length. tip = one-line scaffold, optional to follow.

export const ARTICULATION_PROMPTS = [
  { id: 'art_01', seconds: 60, title: 'The raise', text: 'Explain why you deserve a raise this year. You have 60 seconds.', tip: 'Lead with the result you delivered, then the evidence.' },
  { id: 'art_02', seconds: 45, title: 'Your work in one breath', text: 'A stranger at a dinner asks what you do. Answer so they could repeat it to someone else.', tip: 'One sentence of what, one of who it helps, one example.' },
  { id: 'art_03', seconds: 60, title: 'Bad news first', text: 'A project you lead will miss its deadline by two weeks. Tell your client.', tip: 'State the delay in the first sentence, then the cause, then the plan.' },
  { id: 'art_04', seconds: 90, title: 'Defend a choice', text: 'Pick a design or business decision you made recently and defend it against the strongest objection.', tip: 'Name the objection yourself before answering it.' },
  { id: 'art_05', seconds: 60, title: 'Explain a process', text: 'Explain how something in your field gets made, from idea to finished product, to someone outside it.', tip: 'Use three stages and one concrete example.' },
  { id: 'art_06', seconds: 30, title: 'The 30-second case', text: 'Make the case for one change you would make to your city.', tip: 'Point, one reason, one picture of the result.' },
  { id: 'art_07', seconds: 60, title: 'Say no well', text: 'A valued client asks for extra work that is outside the agreed scope. Decline, and keep the relationship.', tip: 'Acknowledge, decline clearly, offer the alternative.' },
  { id: 'art_08', seconds: 90, title: 'Teach one idea', text: 'Teach one idea you believe every junior person in your field should understand.', tip: 'Idea, why it matters, a mistake it prevents.' },
  { id: 'art_09', seconds: 45, title: 'Summarize a meeting', text: 'You just left a meeting where a launch was approved with conditions. Summarize it for your boss.', tip: 'Decision first, then conditions, then the next step and owner.' },
  { id: 'art_10', seconds: 60, title: 'Compare two options', text: 'Compare two tools or methods you use, and say which one you would pick for a beginner.', tip: 'Give the verdict first. Then the one trade-off that decides it.' },
  { id: 'art_11', seconds: 60, title: 'Introduce yourself to a room', text: 'Open a talk to 50 people who have never heard of you. Give them a reason to listen.', tip: 'Start with something they care about, not with your biography.' },
  { id: 'art_12', seconds: 90, title: 'Tell a short story', text: 'Tell the story of a time a plan failed and what you changed afterwards.', tip: 'Situation, what went wrong, what you did, what you do differently now.' },
  { id: 'art_13', seconds: 45, title: 'Answer the hard question', text: 'Someone asks: "Why should we pay more for your work when others charge less?" Answer.', tip: 'Do not apologise for the price. Point to what the difference buys.' },
  { id: 'art_14', seconds: 60, title: 'Give feedback', text: 'Give feedback to a colleague whose work was good but late. Keep it specific and kind.', tip: 'One thing that worked, the issue, the change you are asking for.' },
];

export function promptById(id) {
  return ARTICULATION_PROMPTS.find((p) => p.id === id) || null;
}

/** Picks a prompt, avoiding the most recent ones where possible. */
export function pickPrompt(recentIds = [], rand = Math.random) {
  const fresh = ARTICULATION_PROMPTS.filter((p) => !recentIds.includes(p.id));
  const pool = fresh.length ? fresh : ARTICULATION_PROMPTS;
  return pool[Math.floor(rand() * pool.length)];
}
