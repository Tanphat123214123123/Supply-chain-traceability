import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { CreateBatchDTO } from '../../domain/types';
import { AuthService } from '../../services/authService';
import { SupplyChainService } from '../../services/supplyChainService';
import { asyncHandler } from '../middleware/error';
import { requireAuth, requireRole } from '../middleware/auth';
import { validateBody, validateQuery } from '../middleware/validate';
import {
  createBatchSchema,
  exportBatchesQuerySchema,
  paginationSchema,
  recallBatchSchema,
} from '../../validation/schemas';

const CSV_HEADERS = ['id', 'productName', 'productType', 'origin', 'quantity', 'unit', 'currentStage', 'isRecalled', 'createdAt'] as const;

/**
 * RFC 4180 CSV for machine consumers: CRLF record separators, every field
 * quoted (commas, quotes and line breaks inside values stay safe), a header
 * row even with zero data rows, and a UTF-8 BOM so spreadsheet apps detect
 * the encoding instead of mangling Vietnamese. Timestamps are ISO 8601 UTC and
 * numbers use "." — locale-neutral on purpose. People get .xlsx from the UI.
 */
export function toCsv(rows: Array<Record<(typeof CSV_HEADERS)[number], unknown>>): string {
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [CSV_HEADERS.map(escape).join(','), ...rows.map((r) => CSV_HEADERS.map((h) => escape(r[h])).join(','))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function batchRoutes(
  supplyChainService: SupplyChainService,
  authService: AuthService,
  publicOrigin: string,
): Router {
  const router = Router();
  router.use(requireAuth(authService));

  router.get(
    '/',
    validateQuery(paginationSchema),
    asyncHandler(async (req, res) => {
      const query = req.query as unknown as z.infer<typeof paginationSchema>;
      res.json(await supplyChainService.listBatchesPage(req.actor!, query));
    }),
  );

  router.get(
    '/pending',
    asyncHandler(async (req, res) => {
      res.json(await supplyChainService.listPendingForActor(req.actor!));
    }),
  );

  router.get(
    '/export',
    validateQuery(exportBatchesQuerySchema),
    asyncHandler(async (req, res) => {
      const { from, to, origin, format } = req.query as unknown as z.infer<typeof exportBatchesQuerySchema>;
      const batches = await supplyChainService.exportBatches(req.actor!, { from, to, origin });

      if (format === 'json') {
        res.json(batches);
        return;
      }

      const rows = batches.map((b) => ({
        id: b.id,
        productName: b.productName,
        productType: b.productType,
        origin: b.origin,
        quantity: b.quantity,
        unit: b.unit,
        currentStage: b.currentStage ?? '',
        isRecalled: b.isRecalled,
        createdAt: b.createdAt.toISOString(),
      }));
      res
        .type('text/csv; charset=utf-8; header=present')
        .attachment(`bao-cao-lo-hang-${new Date().toISOString().slice(0, 10)}.csv`)
        .send(toCsv(rows));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(await supplyChainService.getBatch(req.actor!, req.params.id));
    }),
  );

  router.post(
    '/',
    // A batch represents a physical good's origin — only the actor who
    // actually harvested it (or an ADMIN, for corrections/imports) can bring
    // one into existence. Without this, any role at the far end of the chain
    // (e.g. a RETAILER) could fabricate a "batch" out of thin air with no
    // harvest behind it.
    requireRole('FARMER', 'ADMIN'),
    validateBody(createBatchSchema),
    asyncHandler(async (req, res) => {
      const dto = req.body as CreateBatchDTO;
      const batch = await supplyChainService.createBatch(req.actor!, dto);
      res.status(201).json(batch);
    }),
  );

  router.post(
    '/:id/recall',
    // INSPECTOR is the role that actually performs QUALITY_CHECK — real
    // recall workflows (food/drug safety) let the inspector who found the
    // problem trigger it immediately rather than waiting on ADMIN sign-off.
    requireRole('ADMIN', 'INSPECTOR'),
    validateBody(recallBatchSchema),
    asyncHandler(async (req, res) => {
      const { reason } = req.body as { reason: string };
      const batch = await supplyChainService.recallBatch(req.actor!, req.params.id, reason);
      res.json(batch);
    }),
  );

  router.get(
    '/:id/qr',
    asyncHandler(async (req, res) => {
      await supplyChainService.getBatch(req.actor!, req.params.id); // 404 if missing or wrong tenant
      const url = `${publicOrigin}/provenance/${req.params.id}`;
      const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 256 });
      res.type('image/svg+xml').send(svg);
    }),
  );

  return router;
}
