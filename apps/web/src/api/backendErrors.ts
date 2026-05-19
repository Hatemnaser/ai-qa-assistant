export async function getBackendError(response: Response, fallback: string) {
  const text = await response.text();

  if (!text) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return parsed.error || parsed.message || fallback;
  } catch {
    return text;
  }
}
