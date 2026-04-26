const form = document.querySelector("form");
const chatArea = document.querySelector("#chat-area");
const inputMessage = document.querySelector("#message");

const API_URL = "http://localhost:5000/api/chat";

function addMessage(className, text) {
  const message = document.createElement("p");
  message.className = className;
  message.innerText = text;
  chatArea.appendChild(message);
  chatArea.scrollTop = chatArea.scrollHeight;
}

async function sendMessageToAI(userMessage) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: userMessage,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to get response from backend");
  }

  const data = await response.json();
  return data.reply;
}

form.onsubmit = async (e) => {
  e.preventDefault();

  const userMessage = inputMessage.value.trim();

  if (userMessage === "") {
    alert("Please insert a value");
    return;
  }

  addMessage("msg", userMessage);
  inputMessage.value = "";

  addMessage("answer", "Thinking...");

  try {
    const botReply = await sendMessageToAI(userMessage);

    const thinkingMessage = chatArea.lastElementChild;
    thinkingMessage.innerText = botReply;
  } catch (error) {
    const thinkingMessage = chatArea.lastElementChild;
    thinkingMessage.innerText =
      "Sorry, something went wrong. Please make sure the backend server is running.";
    console.error(error);
  }
};