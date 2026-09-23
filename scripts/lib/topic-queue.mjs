const markers = {
  candidates: "<!-- tech-topics:candidates:v1 -->",
  selected: "<!-- tech-topics:selected:v1 -->"
};

function readMarkedJson(body, kind) {
  if (!body.includes(markers[kind])) return null;
  const tail = body.slice(body.indexOf(markers[kind]) + markers[kind].length);
  const match = tail.match(/^\s*```json\s*\n([\s\S]*?)\n```(?:\s|$)/);
  if (!match) throw new Error(`Malformed ${kind} comment: expected JSON fence`);
  return JSON.parse(match[1]);
}

export function parseQueue(comments) {
  const candidates = [];
  const selections = [];
  for (const comment of [...comments].sort((a, b) => a.id - b.id)) {
    const batch = readMarkedJson(comment.body || "", "candidates");
    if (batch) {
      if (!Array.isArray(batch.topics) || batch.topics.length !== 5) {
        throw new Error(`Candidate comment ${comment.id} must contain exactly five topics`);
      }
      for (const topic of batch.topics) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic.slug || "") ||
            !topic.title || !topic.angle || !topic.task ||
            !Array.isArray(topic.frameworks) || topic.frameworks.length < 1 || topic.frameworks.length > 3) {
          throw new Error(`Invalid candidate in comment ${comment.id}`);
        }
        candidates.push({ ...topic, sourceCommentId: comment.id });
      }
    }
    const selected = readMarkedJson(comment.body || "", "selected");
    if (selected) {
      if (!selected.slug || !selected.sourceCommentId) throw new Error(`Invalid selection in comment ${comment.id}`);
      selections.push({ ...selected, commentId: comment.id });
    }
  }
  return { candidates, selections };
}

export function chooseNext({ candidates, selections }, published, randomIndex) {
  const publishedSet = new Set(published);
  const selected = selections.at(-1);
  if (selected && !publishedSet.has(selected.slug)) return { status: "pending", topic: selected };
  const used = new Set(selections.map(item => item.slug));
  const unique = new Map();
  for (const candidate of candidates) {
    if (!publishedSet.has(candidate.slug) && !used.has(candidate.slug) && !unique.has(candidate.slug)) {
      unique.set(candidate.slug, candidate);
    }
  }
  const eligible = [...unique.values()];
  if (!eligible.length) return { status: "empty" };
  const index = randomIndex(eligible.length);
  if (!Number.isInteger(index) || index < 0 || index >= eligible.length) throw new Error("Invalid random index");
  return { status: "selected", topic: eligible[index] };
}

export function selectionComment(topic) {
  const { slug, title, angle, task, frameworks, sourceCommentId } = topic;
  return `Próximo artigo: **${title}** (\`${slug}\`).\n\n${markers.selected}\n\`\`\`json\n${JSON.stringify({ slug, title, angle, task, frameworks, sourceCommentId }, null, 2)}\n\`\`\``;
}
