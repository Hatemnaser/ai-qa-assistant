export function resolveApiBaseUrl(value: string | undefined, production: boolean) {
  const baseUrl = value?.trim() || "";

  if (!production) return baseUrl;

  if (!baseUrl) {
    throw new Error("VITE_API_BASE_URL is required for a production build.");
  }

  try {
    const parsed = new URL(baseUrl);

    if (parsed.protocol !== "https:" || parsed.origin !== baseUrl) {
      throw new Error();
    }
  } catch {
    throw new Error(
      "VITE_API_BASE_URL must be an exact HTTPS origin without a path, query, hash, or trailing slash."
    );
  }

  return baseUrl;
}

export const API_BASE_URL = resolveApiBaseUrl(
  import.meta.env?.VITE_API_BASE_URL,
  import.meta.env?.PROD === true
);
