import { chooseNext, eligibleTopics, parseQueue, selectionComment, validateQueueAgainstRegistry } from "./topic-queue.mjs";

// The workflow serializes writers. Public read-only queries need no credentials.
export function githubQueueAdapter({ repository, issue, token, fetchImpl = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || "") || !Number.isInteger(issue) || issue < 1) {
    throw new Error("A valid repository (owner/name) and positive queue issue number are required");
  }
  const endpoint = `https://api.github.com/repos/${repository}/issues/${issue}/comments`;
  async function request(url, options = {}) {
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetchImpl(url, { ...options, headers: { ...headers, ...options.headers } });
    if (!response.ok) throw new Error(`GitHub queue request failed (HTTP ${response.status})`);
    return response.json();
  }
  return {
    async listComments() {
      const comments = [];
      for (let page = 1; ; page++) {
        const batch = await request(`${endpoint}?per_page=100&page=${page}`);
        if (!Array.isArray(batch)) throw new Error("GitHub returned an invalid comments page");
        comments.push(...batch);
        if (batch.length < 100) return comments;
      }
    },
    async postSelection(topic) {
      if (!token) throw new Error("GITHUB_TOKEN is required to publish a selection");
      return request(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: selectionComment(topic) })
      });
    }
  };
}

export function inspectTopicQueue({ comments, owner, registry, published }) {
  // Bots record selections but cannot curate candidates. Reject mixed bot
  // comments so a selection marker cannot grant curator permissions.
  const trusted = comments.filter(comment => comment.user?.login === owner ||
    (comment.user?.login === "github-actions[bot]" &&
      comment.body?.includes("<!-- tech-topics:selected:v1 -->") &&
      !comment.body.includes("<!-- tech-topics:candidates:v1 -->")));
  let parsed;
  let candidatesOnly;
  try {
    parsed = parseQueue(trusted);
    candidatesOnly = validateQueueAgainstRegistry({ ...parsed, selections: [] }, registry, published);
    const validated = validateQueueAgainstRegistry(parsed, registry, published);
    const eligible = eligibleTopics(validated, published);
    const selection = validated.selections.at(-1) || null;
    const pending = selection && !new Set(published).has(selection.slug);
    return {
      status: pending ? "pending" : eligible.length ? "ready" : "empty",
      selection, eligible, invalidCandidates: validated.invalidCandidates,
      problems: [], ignoredComments: comments.length - trusted.length,
      queue: validated
    };
  } catch (error) {
    return {
      status: "blocked", selection: parsed?.selections.at(-1) || null,
      eligible: candidatesOnly ? eligibleTopics({ ...candidatesOnly, selections: parsed.selections }, published) : [],
      invalidCandidates: candidatesOnly?.invalidCandidates || [], problems: [error.message],
      ignoredComments: comments.length - trusted.length
    };
  }
}

export async function runTopicQueue({ adapter, owner, registry, published, dryRun = false, randomIndex }) {
  const inspect = async () => inspectTopicQueue({ comments: await adapter.listComments(), owner, registry, published });
  let state = await inspect();
  if (dryRun || state.status !== "ready") return publicState(state);
  // Recheck before writing. External writers still need workflow concurrency;
  // the comments API has no compare-and-swap operation.
  state = await inspect();
  if (state.status !== "ready") return publicState(state);
  const result = chooseNext(state.queue, published, randomIndex);
  const comment = await adapter.postSelection(result.topic);
  return {
    ...publicState(state), status: "selected",
    selection: { ...result.topic, commentId: comment.id },
    eligible: state.eligible.filter(topic => topic.slug !== result.topic.slug)
  };
}

function publicState({ queue, ...state }) { return state; }

export function queueSummary(result) {
  const lines = ["## Fila editorial", "", `Estado: **${result.status}**`, ""];
  if (result.selection) lines.push(`Seleção: \`${result.selection.slug}\` (comentário ${result.selection.commentId})`, "");
  lines.push(`Candidatas elegíveis: ${result.eligible.length}`, `Candidatas inválidas: ${result.invalidCandidates.length}`, `Comentários ignorados: ${result.ignoredComments}`);
  for (const invalid of result.invalidCandidates) lines.push(`- Comentário ${invalid.sourceCommentId}: referências de registry inválidas`);
  if (result.status === "blocked") lines.push("", "Impedimento: contrato da fila inválido; consulte o resultado JSON e corrija a curadoria explicitamente.");
  return lines.join("\n") + "\n";
}
