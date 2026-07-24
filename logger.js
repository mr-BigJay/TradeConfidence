const path = require("node:path");
const winston = require("winston");
const config = require("./config/config");

const logFormat = winston.format.printf(({ timestamp, level, message, symbol, ...meta }) => {
  const symbolPrefix = symbol ? `[${symbol}] ` : "";
  const serializedMeta = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";

  return `${timestamp} ${level}: ${symbolPrefix}${message}${serializedMeta}`;
});

const logger = winston.createLogger({
  level: config.runtime.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    logFormat,
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join("logs", "app.log"),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join("logs", "error.log"),
      level: "error",
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

module.exports = logger;
