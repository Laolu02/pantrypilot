export const gbp = (minor: number) => `£${(minor / 100).toFixed(2)}`;
export function qty(n: number, unit: string) {
  if (unit === "count") return `${Math.round(n * 10) / 10}`;
  if (unit === "ml") return n >= 1000 ? `${(n / 1000).toFixed(2).replace(/\.?0+$/, "")} L` : `${Math.round(n)} ml`;
  return n >= 1000 ? `${(n / 1000).toFixed(2).replace(/\.?0+$/, "")} kg` : `${Math.round(n)} g`;
}
export function daysUntil(iso: string | null) {
  if (!iso) return null;
  return Math.round(((new Date(iso).getTime() - Date.now()) / 86400000) * 10) / 10;
}
export function ago(iso: string | null) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
export const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const human = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
export const money = (minor: number, currency: "GBP" | "USD" = "GBP") => `${currency === "GBP" ? "£" : "$"}${(minor / 100).toFixed(2)}`;
