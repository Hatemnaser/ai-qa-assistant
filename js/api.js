const API_URL = "http://127.0.0.1:5000/api/chat";

export async function sendMessageToAI({ message, mode, image = null }) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      mode,
      image,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Backend error status:", response.status);
    console.error("Backend error body:", errorText);

    throw new Error("Failed to get response from backend");
  }

  const data = await response.json();
  return data.reply;
}