import { Router } from 'express';
import * as publicProfileController from '../controllers/publicProfileController.js';

const router = Router();

/**
 * @swagger
 * /api/public/professionals:
 *   get:
 *     summary: List slugs of opt-in public profiles (used to build the sitemap)
 *     tags: [Public Profiles]
 *     responses:
 *       200: { description: Slug feed }
 */
router.get('/professionals', publicProfileController.listPublicProfiles);

/**
 * @swagger
 * /api/public/professionals/{slug}:
 *   get:
 *     summary: Public career summary for an opt-in professional (no auth)
 *     description: >
 *       Returns a conservative, publicly shareable summary. Contains no contact details,
 *       documents, certificate numbers, vessel/employer names or exact dates. Returns 404
 *       unless the professional has explicitly enabled their public profile.
 *     tags: [Public Profiles]
 *     responses:
 *       200: { description: Public profile }
 *       404: { description: Not found or not public }
 */
router.get('/professionals/:slug', publicProfileController.getPublicProfile);

export default router;
