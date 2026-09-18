/**
 * Proxy HTTPS di NordVPN (porta 89) su un server scelto a caso fra i 20 consigliati per il paese,
 * così ogni run esce da un IP diverso. Le credenziali sono le "service credentials" del Nord Account
 * (Manual setup), non quelle di login.
 */
const NORD_API = "https://api.nordvpn.com/v1/servers/recommendations";

type Server = { technologies: { identifier: string; metadata: { name: string; value: string }[] }[] };

export async function randomProxy(nordId: number): Promise<{ host: string; url: string }> {
  const user = Bun.env.NORD_USER;
  const pass = Bun.env.NORD_PASS;
  if (!user || !pass) throw new Error("NORD_USER/NORD_PASS mancanti in .env (vedi .env.example)");
  const url = new URL(NORD_API);
  url.search = new URLSearchParams({
    "filters[servers_technologies][identifier]": "proxy_ssl",
    "filters[country_id]": String(nordId),
    limit: "20",
  }).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`nordvpn recommendations failed: ${res.status}`);
  const servers: Server[] = await res.json();
  const hosts = servers.flatMap((s) =>
    s.technologies
      .filter((t) => t.identifier === "proxy_ssl")
      .flatMap((t) => t.metadata.filter((m) => m.name === "proxy_hostname").map((m) => m.value)),
  );
  if (!hosts.length) throw new Error(`nessun server proxy_ssl per il paese ${nordId}`);
  const host = hosts[Math.floor(Math.random() * hosts.length)]!;
  return { host, url: `https://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:89` };
}
