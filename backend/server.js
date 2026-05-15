const express = require("express");
const cors = require("cors");
require("dotenv").config();

const geminiClient = require("./geminiClient");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "25mb" }));

app.get("/", (req, res) => {
  res.send("AI QA Assistant backend is running");
});

app.post("/api/chat", async (req, res) => {
  try {
    const {
      message,
      mode = "general",
      model,
      history = [],
      image,
    } = req.body;
    const requestedModel = typeof model === "string" ? model.trim() : model;

    console.log("Mode:", mode);
    console.log("Model:", requestedModel);
    console.log("History count:", Array.isArray(history) ? history.length : 0);
    console.log("Has image:", Boolean(image && image.data && image.mimeType));
    console.log("Image mime:", image?.mimeType);
    console.log("Image size:", image?.data?.length);

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Message is required and must be a string.",
      });
    }

    if (!Array.isArray(history)) {
      return res.status(400).json({
        error: "History must be an array when provided.",
      });
    }

    if (requestedModel && !geminiClient.ALLOWED_MODELS.includes(requestedModel)) {
      return res.status(400).json({
        error: `Unsupported Gemini model: ${requestedModel}. Allowed models: ${geminiClient.ALLOWED_MODELS.join(", ")}.`,
      });
    }

    const response = await geminiClient.chat({
      message,
      mode,
      model: requestedModel,
      history,
      image,
    });

    res.json({
      reply: response.reply,
      mode,
      model: response.model || geminiClient.DEFAULT_MODEL,
    });
  } catch (error) {
    console.error("Chat API Error:", error);

    const errorMessage =
      error instanceof Error
        ? error.message
        : "Server error while processing the request.";
    const statusCode = getResponseStatus(error, errorMessage);

    res.status(statusCode).json({
      error: errorMessage,
    });
  }
});

app.use((error, req, res, next) => {
  console.error("Express Error:", error);

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      error: "Uploaded image is too large. Please use a smaller screenshot.",
    });
  }

  res.status(500).json({
    error: "Server error while processing the request.",
  });
});

function getResponseStatus(error, message) {
  const status = Number(error?.status || error?.httpStatus || error?.code);

  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    return status;
  }

  if (String(message || "").includes("timed out")) {
    return 504;
  }

  return 500;
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
