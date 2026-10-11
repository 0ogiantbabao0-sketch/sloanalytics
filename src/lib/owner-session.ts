export const COOKIE_NAME = "slot_owner";
export function privateAccess() {
  return (
    process.env.PRIVATE_ACCESS === "true" ||
    (process.env.NODE_ENV === "production" &&
      process.env.PRIVATE_ACCESS !== "false")
  );
}
const bytes = (s: string) => new TextEncoder().encode(s);
function secret() {
  const v = process.env.OWNER_SESSION_SECRET;
  if (!v || v.length < 32)
    throw new Error("OWNER_SESSION_SECRET（32文字以上）を設定してください");
  return v;
}
const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b), (v) => v.toString(16).padStart(2, "0")).join(
    "",
  );
async function key() {
  return crypto.subtle.importKey(
    "raw",
    bytes(secret() + ":" + (process.env.OWNER_PASSWORD || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function createSession() {
  const payload = String(Math.floor(Date.now() / 1000) + 43200);
  return `${payload}.${hex(await crypto.subtle.sign("HMAC", await key(), bytes(payload)))}`;
}
export async function validSession(token: string) {
  try {
    const [exp, sig, ...rest] = token.split(".");
    if (
      rest.length ||
      !/^\d{10}$/.test(exp) ||
      !/^[a-f0-9]{64}$/.test(sig) ||
      Number(exp) <= Date.now() / 1000 ||
      Number(exp) > Date.now() / 1000 + 43260
    )
      return false;
    return await crypto.subtle.verify(
      "HMAC",
      await key(),
      Uint8Array.from(sig.match(/../g)!, (v) => parseInt(v, 16)),
      bytes(exp),
    );
  } catch {
    return false;
  }
}
export async function ownerRequest(req: Request) {
  const value = req.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(COOKIE_NAME + "="))
    ?.slice(COOKIE_NAME.length + 1);
  return !!value && privateAccess() && (await validSession(value));
}
