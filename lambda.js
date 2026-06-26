const serverless = require('serverless-http');
const { app, secretsReady } = require('./server');

const wrappedHandler = serverless(app);

module.exports.handler = async (event, context) => {
  await secretsReady;
  return wrappedHandler(event, context);
};
