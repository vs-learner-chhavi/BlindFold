/**
 * Blindfold reporting: components 5, 6 and 7.
 *   const reporting = require('../reporting');
 */
const { loadEnv } = require('./src/env');

loadEnv();

const { generateReport, toMarkdown } = require('./src/reportGenerator');
const { findContacts } = require('./src/contactFinder');
const { TinyFishClient, TinyFishError } = require('./src/tinyfishClient');
const { DeliveryService, DEFAULT_POLICY } = require('./src/delivery/deliveryService');
const { Sender } = require('./src/delivery/sender');
const { createRouter } = require('./src/router');

module.exports = {
  // Component 5
  generateReport, toMarkdown,
  // Component 6
  findContacts, TinyFishClient, TinyFishError,
  // Component 7
  DeliveryService, DEFAULT_POLICY, Sender,
  // Express routes for backend/server.js
  createRouter,
};
