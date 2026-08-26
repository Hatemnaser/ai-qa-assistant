export interface TestCsrfHeaders extends Record<string, string> {
  cookie: string;
  "x-csrf-token": string;
}

export async function getCsrfHeaders(baseUrl: string, extraCookie = ""): Promise<TestCsrfHeaders> {
  const response = await fetch(`${baseUrl}/api/auth/csrf`, {
    method: "GET",
  });
  const body = (await response.json()) as { csrfToken?: string };
  const setCookie = response.headers.get("set-cookie") || "";
  const csrfCookie = setCookie.split(";")[0];
  const csrfToken = body.csrfToken;

  if (response.status !== 200) {
    throw new Error(`Expected CSRF token endpoint to return 200, received ${response.status}.`);
  }

  if (!csrfToken) {
    throw new Error("Expected CSRF token endpoint response to include csrfToken.");
  }

  if (!csrfCookie) {
    throw new Error("Expected CSRF token endpoint response to set a CSRF cookie.");
  }

  return {
    cookie: extraCookie ? `${csrfCookie}; ${extraCookie}` : csrfCookie,
    "x-csrf-token": csrfToken,
  };
}
