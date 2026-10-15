/** Buffer GraphQL API. Keep API key server-side only. */
export type BufferChannel = {
  id: string; name: string; displayName?: string | null; service: string; organizationId: string;
};
type GraphQLResult<T> = { data?: T; errors?: Array<{message?: string}> };

export function bufferConfigured() { return Boolean(process.env.BUFFER_API_KEY?.trim()); }

export async function bufferGraphQL<T>(query: string): Promise<T> {
  const key = process.env.BUFFER_API_KEY?.trim();
  if (!key) throw new Error("BUFFER_API_KEY nao configurada na Vercel.");
  const response = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({query}),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({})) as GraphQLResult<T>;
  if (!response.ok) throw new Error(`Buffer HTTP ${response.status}. Confira sua API Key.`);
  if (body.errors?.length) throw new Error(body.errors.map(e => e.message ?? "Erro GraphQL").join("; "));
  if (!body.data) throw new Error("Buffer nao retornou dados.");
  return body.data;
}

export async function listTikTokBufferChannels(): Promise<BufferChannel[]> {
  const { account } = await bufferGraphQL<{account: {organizations: Array<{id: string; name: string}>}}>(
    "query { account { organizations { id name } } }");
  const groups = await Promise.all((account?.organizations ?? []).map(async org => {
    const result = await bufferGraphQL<{channels: Array<{id:string; name:string; displayName?:string|null; service:string; isDisconnected:boolean; isLocked:boolean}>}>(
      `query { channels(input: { organizationId: ${JSON.stringify(org.id)} }) { id name displayName service isDisconnected isLocked } }`);
    return (result.channels ?? []).filter(channel =>
      channel.service?.toLowerCase() === "tiktok" && !channel.isDisconnected && !channel.isLocked
    ).map(channel => ({ id: channel.id, name: channel.name, displayName: channel.displayName, service: channel.service, organizationId: org.id }));
  }));
  return groups.flat();
}

export async function createScheduledBufferPost(input: {
  channelId: string; videoUrl: string; text: string; dueAt: string;
}): Promise<{id:string; status:string}> {
  const query = `mutation {
    createPost(input: {
      text: ${JSON.stringify(input.text)}
      channelId: ${JSON.stringify(input.channelId)}
      schedulingType: automatic
      mode: customScheduled
      dueAt: ${JSON.stringify(input.dueAt)}
      assets: [{ video: { url: ${JSON.stringify(input.videoUrl)} } }]
    }) {
      ... on PostActionSuccess { post { id status } }
      ... on MutationError { message }
    }
  }`;
  const data = await bufferGraphQL<{createPost: {post?: {id:string; status:string}; message?:string}}>(query);
  if (!data.createPost?.post?.id) throw new Error(data.createPost?.message || "Buffer nao aceitou a postagem.");
  return data.createPost.post;
}

export async function getBufferPost(id: string): Promise<{id:string; status:string; dueAt:string|null}> {
  const data = await bufferGraphQL<{post: {id:string; status:string; dueAt:string|null}|null}>(
    `query { post(input: { id: ${JSON.stringify(id)} }) { id status dueAt } }`);
  if (!data.post) throw new Error("Publicacao nao encontrada no Buffer.");
  return data.post;
}
