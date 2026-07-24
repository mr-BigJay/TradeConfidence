const config = require("../config/config");
const logger = require("../logger");
const { renderAnalysisCard } = require("./cardImage");
const { generateAnalysisCardWithApi } = require("./cardImageApi");

async function renderCard(analysis) {
  const mode = config.runtime.cardMode;

  if (mode === "html") {
    return renderAnalysisCard(analysis);
  }

  try {
    return await generateAnalysisCardWithApi(analysis);
  } catch (error) {
    logger.error("Image API failed", { error: error.message });

    if (mode === "api" || mode === "auto") {
      logger.warn("Falling back to HTML card renderer so Telegram still gets an image");
      return renderAnalysisCard(analysis);
    }

    throw error;
  }
}

module.exports = {
  renderCard,
};
