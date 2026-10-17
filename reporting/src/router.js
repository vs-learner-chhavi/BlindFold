/**
 * Optional Express routes so the team's backend/server.js can use components 5, 6 and 7.
 *
 * In backend/server.js:
 *   const express = require('express');
 *   const reporting = require('../reporting');
 *   app.use('/api/reporting', reporting.createRouter(express));
 *
 * Endpoints:
 *   POST /api/reporting/incident        body = incident JSON from the Snapshot System (component 2)
 *   GET  /api/reporting/tracker         data for the Public Tracker Dashboard (component 8)
 *   POST /api/reporting/run             check the sending rules now (also runs every hour)
 *   POST /api/reporting/fixed/:fp       Verification System (component 9) marks an issue fixed
 */

const { generateReport } = require('./reportGenerator');
const { findContacts } = require('./contactFinder');
const { DeliveryService } = require('./delivery/deliveryService');

function createRouter(express, { service = new DeliveryService(), runEveryMs = 60 * 60 * 1000 } = {}) {
  const router = express.Router();
  router.use(express.json({ limit: '2mb' }));

  if (runEveryMs) setInterval(() => service.run().catch(console.error), runEveryMs).unref();

  router.post('/incident', async (req, res) => {
    try {
      const incident = req.body;
      if (!incident || !incident.page_url) return res.status(400).json({ error: 'page_url is required' });
      const report = generateReport(incident);

      // Look up contacts only once per website (saves TinyFish calls).
      let contacts = null;
      const site = service.sites[report.website.domain];
      if (!site || !site.contactValue) {
        try { contacts = await findContacts(incident.page_url); } catch (e) { console.warn('Contact lookup failed:', e.message); }
      }
      service.ingest(report, incident.user_ref || 'anonymous', contacts);
      res.json({ report, contacts });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/tracker', (_req, res) => res.json(service.tracker()));

  router.post('/run', async (_req, res) => {
    try { res.json(await service.run()); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/fixed/:fingerprint', (req, res) => {
    service.markFixed(req.params.fingerprint);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createRouter };
