/* eslint-disable @typescript-eslint/no-var-requires */
const prettier = require('prettier');
const logger = require('signale');

const formatter = code =>
  prettier.format(code, {
    parser: 'typescript',
    semi: true,
    singleQuote: true,
    trailingComma: 'all',
  });

const format = code =>
  new Promise((resolve, reject) => {
    try {
      const result = formatter(code);

      resolve(result);
    } catch (err) {
      logger.fatal(err);
      resolve(code);
    }
  });

module.exports = {
  formatter,
  format,
};
