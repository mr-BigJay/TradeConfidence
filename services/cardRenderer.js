const config = require("../config/config");
const logger = require("../logger");
const { renderAnalysisCard } = require("./cardImage");
const { generateAnalysisCardWithApi } = require("./cardImageApi");

/**
 * Card images are generated on the server (HTML → PNG) by default.
 * API image generation is opt-in only via CARD_MODE=api|auto.
 */
async function renderCard(analysis) {
  const mode = config.runtime.cardMode;

  if (mode === "html") {
    logger.info("Rendering card on server (HTML → PNG)");
    return renderAnalysisCard(analysis);
  }

  try {
    logger.info("Rendering card via image API", { mode });
    return await generateAnalysisCardWithApi(analysis);
  } catch (error) {
    logger.error("Image API failed", { error: error.message });

    if (mode === "api" || mode === "auto") {
      logger.warn("Falling back to server HTML card renderer");
      return renderAnalysisCard(analysis);
    }

    throw error;
  }
}

module.exports = {
  renderCard,
};
