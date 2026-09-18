/**
 * Client side of public trader profiles.
 *
 * Every write is authorised by a signature from a wallet that belongs to the profile — the backend recovers the
 * signer and compares it, so nothing here is trusted. Signing works with either wallet the site supports: the
 * in-browser trading wallet (no popup) or an injected browser wallet (personal_sign).
 */
import { hotSignMessage } from "./arc-hotwallet";
import { getEth } from "./arc-wallet";

const API = "/bot";

export type Profile = {
  handle: string;
  display: string | null;
  bio: string | null;
  avatar: string | null;
  banner: string | null;
  x_handle: string | null;
  x_verified: number;
  public_positions: number;
  feed_delay: number;
  created: number;
  seeded?: number;
};

export type ProfileStats = {
  pnl_realized?: number; pnl_unrealized?: number; pnl_total?: number; roi?: number | null;
  winrate?: number | null; trades?: number; closed?: number; volume?: number;
  best_symbol?: string; best_pnl?: number; last_trade?: number; first_trade?: number;
  days_active?: number; wallets?: string[]; range?: string;
};

export type Badge = { id: string; label: string; tone: string };

export type ProfileView = { profile: Profile | null; stats?: ProfileStats; badges?: Badge[]; followers?: number };

export type LeaderRow = {
  handle: string; display: string | null; avatar: string | null; x_handle: string | null; x_verified: number;
  pnl_total: number | null; roi: number | null; winrate: number | null; volume: number | null;
  trades: number | null; closed: number | null; ranked?: boolean;
};

export type ProfileTrade = {
  ts: number; token: string; side: string; usdc: number; tokens: number; price1m: number;
  wallet: string; symbol: string | null; logo: string | null;
};

export type ChartMark = {
  ts: number; side: string; usdc: number; handle: string; display: string | null;
  avatar: string | null; x_verified: number;
};

/** The exact string the backend rebuilds and recovers — keep both sides identical. */
export function authMessage(action: string, handle: string, wallet: string, ts: number) {
  return `ArcTools profile\naction: ${action}\nhandle: ${handle}\nwallet: ${wallet.toLowerCase()}\nts: ${ts}`;
}

export async function signAs(wallet: string, action: string, handle: string): Promise<{ ts: number; sig: string }> {
  const ts = Math.floor(Date.now() / 1000);
  const message = authMessage(action, handle, wallet, ts);
  let sig: string;
  try {
    sig = await hotSignMessage(message);            // trading wallet: signs locally, no popup
  } catch {
    const eth = getEth();
    if (!eth) throw new Error("no wallet available to sign with");
    sig = (await eth.request({ method: "personal_sign", params: [message, wallet] })) as string;
  }
  return { ts, sig };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const text = await r.text();
  let j: T & { error?: string };
  try {
    j = JSON.parse(text) as T & { error?: string };
  } catch {
    throw new Error(`server returned ${text.slice(0, 60) || "an empty response"}`);
  }
  if (j.error) throw new Error(j.error);
  return j;
}

async function get<T>(path: string, fallback: T): Promise<T> {
  try {
    const r = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(12_000) });
    const text = await r.text();
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export const getProfile = (handle: string, range = "all") =>
  get<ProfileView>(`/api/profile?handle=${encodeURIComponent(handle)}&range=${range}`, { profile: null });

export const getProfileByWallet = (wallet: string) =>
  get<ProfileView>(`/api/profile?wallet=${wallet.toLowerCase()}`, { profile: null });

export const getLeaderboard = (season: string, sort: string, relaxed = false) =>
  get<{ rows: LeaderRow[] }>(
    `/api/profiles/leaderboard?season=${season}&sort=${sort}&limit=50${relaxed ? "&relaxed=1" : ""}`, { rows: [] });

export const getProfileTrades = (handle: string, limit = 30) =>
  get<{ trades: ProfileTrade[]; delay?: number }>(`/api/profile/trades?handle=${handle}&limit=${limit}`, { trades: [] });

export const getChartProfiles = (token: string, from?: number) =>
  get<{ marks: ChartMark[] }>(`/api/profiles/chart?token=${token.toLowerCase()}${from ? `&from=${from}` : ""}`, { marks: [] });

export const getProfilesByWallets = (wallets: string[]) =>
  get<{ profiles: Record<string, { handle: string; display: string | null; avatar: string | null; x_verified: number }> }>(
    `/api/profiles/by-wallets?wallets=${wallets.slice(0, 100).join(",")}`, { profiles: {} });

export const getFollowing = (wallet: string) =>
  get<{ following: { handle: string; ts: number }[] }>(`/api/profile/following?wallet=${wallet.toLowerCase()}`, { following: [] });

export async function saveProfile(wallet: string, handle: string, fields: Partial<Profile>) {
  const { ts, sig } = await signAs(wallet, "save", handle);
  return post<{ ok: boolean; handle: string }>("/api/profile/save", { handle, wallet, ts, sig, ...fields });
}

export async function addWallet(wallet: string, handle: string) {
  const { ts, sig } = await signAs(wallet, "wallet", handle);
  return post<{ ok: boolean; added: string }>("/api/profile/wallet", { handle, wallet, ts, sig });
}

export async function removeWallet(wallet: string, handle: string) {
  const { ts, sig } = await signAs(wallet, "wallet", handle);
  return post<{ ok: boolean; removed: string }>("/api/profile/wallet", { handle, wallet, ts, sig, remove: true });
}

export async function startXVerify(wallet: string, handle: string) {
  const { ts, sig } = await signAs(wallet, "xstart", handle);
  return post<{ code: string; post: string }>("/api/profile/x/start", { handle, wallet, ts, sig });
}

export async function finishXVerify(wallet: string, handle: string) {
  const { ts, sig } = await signAs(wallet, "xverify", handle);
  return post<{ ok: boolean; verified?: string; error?: string }>("/api/profile/x/verify", { handle, wallet, ts, sig });
}

/**
 * Send a picture for the avatar or banner. The file is downscaled in the browser first, so a 12 MP phone photo
 * does not travel as 8 MB over mobile data; the server re-encodes again and strips EXIF regardless.
 */
export async function uploadProfileImage(wallet: string, handle: string, kind: "avatar" | "banner", file: File) {
  const maxEdge = kind === "banner" ? 1600 : 640;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("could not read that file"));
    fr.onload = () => resolve(String(fr.result));
    fr.readAsDataURL(file);
  });
  const shrunk = await new Promise<string>((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(dataUrl);            // let the server deal with exotic formats
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      if (scale === 1 && dataUrl.length < 1_500_000) { resolve(dataUrl); return; }
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d");
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.88));
    };
    img.src = dataUrl;
  });
  const { ts, sig } = await signAs(wallet, "image", handle);
  return post<{ ok: boolean; url: string; bytes: number }>("/api/profile/image",
    { handle, wallet, ts, sig, kind, data: shrunk });
}

export async function follow(wallet: string, handle: string, target: string, off = false) {
  const { ts, sig } = await signAs(wallet, "follow", handle);
  return post<{ ok: boolean; following: boolean }>("/api/profile/follow", { handle, wallet, ts, sig, target, off });
}
