const TOKEN_KEY = "narcosim.github.token.v1";
const GIST_FILENAME = "narcosim-partida.json";
const API_BASE = "https://api.github.com";

/** The token lives only in this browser's localStorage. It is entered by the player into a
 * settings field in the running app and is never embedded in source code, never committed,
 * and never sent anywhere except directly from the browser to the GitHub API. */
export function getGithubToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setGithubToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function githubRequest(token, path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).message || "";
    } catch {
      // ignore: some error responses aren't JSON
    }
    throw new Error(`GitHub respondió ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

/** Creates a new secret Gist (if gistId is falsy) or updates an existing one. Returns the gist id.
 * A "secret" Gist is unlisted, not access-controlled — anyone with the link or id can read it. */
export async function saveGameToGist(token, gistId, gameState) {
  const body = {
    description: `Narcosim — partida guardada (${gameState.eraName || ""})`,
    public: false,
    files: { [GIST_FILENAME]: { content: JSON.stringify(gameState, null, 2) } },
  };
  const gist = gistId
    ? await githubRequest(token, `/gists/${gistId}`, { method: "PATCH", body: JSON.stringify(body) })
    : await githubRequest(token, "/gists", { method: "POST", body: JSON.stringify(body) });
  return gist.id;
}

export async function loadGameFromGist(token, gistId) {
  const gist = await githubRequest(token, `/gists/${gistId}`);
  const file = gist.files && gist.files[GIST_FILENAME];
  if (!file) throw new Error("Ese Gist no contiene una partida de Narcosim.");
  let content = file.content;
  if (file.truncated) {
    const res = await fetch(file.raw_url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error("No se pudo descargar el contenido completo del Gist.");
    content = await res.text();
  }
  return JSON.parse(content);
}
