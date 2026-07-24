const config = require("../config/config");
const logger = require("../logger");
const { renderAnalysisCard } = require("./cardImage");
const { generateAnalysisCardWithApi } = require("./cardImageApi");

async function renderCard(analysis) {
  const mode = config.runtime.cardMode;

  if (mode === "api") {
    return generateAnalysisCardWithApi(analysis);
  }

  if (mode === "html") {
    return renderAnalysisCard(analysis);
  }

  // auto: prefer API, fall back to HTML renderer
  try {
    return await generateAnalysisCardWithApi(analysis);
  } catch (error) {
    logger.warn("Image API failed, falling back to HTML card renderer", {
      error: error.message,
    });
    return renderAnalysisCard(analysis);
  }
}

module.exports = {
  renderCard,
};
