const API_URL = "http://127.0.0.1:5000/api/chat";
const REQUEST_TIMEOUT_MS = 60000;

export async function sendMessageToAI({ message, mode, image = null }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;

  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        message,
        mode,
        image,
      }),
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The backend took too long to respond. Please try again.");
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Backend error status:", response.status);
    console.error("Backend error body:", errorText);

    let errorMessage = "Failed to get response from backend";

    try {
      const errorData = JSON.parse(errorText);
      errorMessage = errorData.error || errorMessage;
    } catch (error) {
      errorMessage = errorText || errorMessage;
    }

    throw new Error(errorMessage);
  }

  const data = await response.json();
  return data.reply;
}
