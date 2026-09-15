import fs from 'fs';
import path from 'path';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { EMAIL_BRAND_DEFAULTS, EmailBrandContext } from '@mailer/config.mailer';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BrandIdentity {
  appleTouchIconUrl: string | null;
  logoIconUrl: string | null;
  faviconUrl: string | null;
  primaryHex: string | null;
  logoUrl: string | null;
  appName: string;
}

export interface BrandConfig {
  colors: Record<string, ColorToken>;
  typography: Record<string, string>;
  radius: Record<string, string>;
  motion: Record<string, string>;
  identity: BrandIdentity;
}

export interface ColorToken {
  h: number;
  s: string;
  l: string;
}

// ─── S3 Client ──────────────────────────────────────────────────────────────

const S3_BRAND_PREFIX = 'branding';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const log: Logger = createLogger('BrandingService');

let s3: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      region: envVariables.AWS.REGION,
      credentials: {
        accessKeyId: envVariables.AWS.ACCESS_KEY,
        secretAccessKey: envVariables.AWS.SECRET_KEY,
      },
    });
  }
  return s3;
}

// ─── Paths & Cache ──────────────────────────────────────────────────────────

const DEFAULT_PATH = path.join(__dirname, 'brand.default.json');

interface CachedBrand {
  config: BrandConfig;
  expiresAt: number;
}

const brandCache = new Map<string, CachedBrand>();
let defaultBrand: BrandConfig | null = null;

/**
 * Build an EmailBrandContext from a brand config.
 *
 * Brand visuals (logo, colors) come from the JSON file.
 * Company profile data (address, email) is optionally enriched
 * from the client document when available.
 */
export function toEmailBrandContext(
  config: BrandConfig,
  client?: {
    displayName?: string;
    companyProfile?: {
      tradingName?: string;
      legalEntityName?: string;
      companyAddress?: string;
      companyEmail?: string;
    };
  }
): EmailBrandContext {
  const companyName =
    client?.displayName ||
    client?.companyProfile?.tradingName ||
    client?.companyProfile?.legalEntityName ||
    config.identity.appName;

  const companyAddress = client?.companyProfile?.companyAddress
    ? `${companyName} — ${client.companyProfile.companyAddress}`
    : EMAIL_BRAND_DEFAULTS.companyAddress;

  const primaryColor = config.identity.primaryHex
    ? config.identity.primaryHex
    : config.colors.primary
      ? hslToHex(config.colors.primary.h, config.colors.primary.s, config.colors.primary.l)
      : EMAIL_BRAND_DEFAULTS.primaryColor;

  const secondaryToken = config.colors.secondary;
  const accentColor = secondaryToken
    ? hslToHex(secondaryToken.h, secondaryToken.s, secondaryToken.l)
    : EMAIL_BRAND_DEFAULTS.accentColor;

  return {
    appName: companyName,
    logoUrl: config.identity.logoUrl,
    primaryColor,
    accentColor,
    companyAddress,
    supportEmail: client?.companyProfile?.companyEmail ?? EMAIL_BRAND_DEFAULTS.supportEmail,
  };
}

// ─── S3 fetch ───────────────────────────────────────────────────────────────

/**
 * Load a tenant's brand config.
 *
 * Resolution: S3 `branding/{cuid}.json` merged over brand.default.json.
 * Falls back to the default config if no tenant file exists in S3.
 * Results are cached in-memory with a 5-minute TTL.
 */
export async function loadBrandConfig(cuid?: string): Promise<BrandConfig> {
  const base = getDefaultBrand();
  if (!cuid) return base;

  const cached = brandCache.get(cuid);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.config;
  }

  const tenant = await fetchBrandFromS3(cuid);
  if (!tenant) {
    // Cache the miss too so we don't hit S3 repeatedly for non-existent tenants
    brandCache.set(cuid, { config: base, expiresAt: Date.now() + CACHE_TTL_MS });
    return base;
  }

  const config: BrandConfig = {
    identity: { ...base.identity, ...(tenant.identity ?? {}) },
    colors: { ...base.colors, ...(tenant.colors ?? {}) },
    radius: { ...base.radius, ...(tenant.radius ?? {}) },
    typography: { ...base.typography, ...(tenant.typography ?? {}) },
    motion: { ...base.motion, ...(tenant.motion ?? {}) },
  };

  brandCache.set(cuid, { config, expiresAt: Date.now() + CACHE_TTL_MS });
  return config;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Clear the brand cache. Useful for testing or when brand files are updated.
 */
export function clearBrandCache(): void {
  brandCache.clear();
  defaultBrand = null;
}

async function fetchBrandFromS3(cuid: string): Promise<Partial<BrandConfig> | null> {
  try {
    const command = new GetObjectCommand({
      Bucket: envVariables.AWS.BUCKET_NAME,
      Key: `${S3_BRAND_PREFIX}/${cuid}.json`,
    });

    const response = await getS3Client().send(command);
    if (!response.Body) return null;

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf-8');
    return JSON.parse(raw) as Partial<BrandConfig>;
  } catch (error: any) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
      return null; // No brand file for this tenant
    }
    log.warn({ error: error.message, cuid }, 'Failed to fetch brand config from S3');
    return null;
  }
}

function hslToHex(h: number, s: string, l: string): string {
  const sNum = parseFloat(s) / 100;
  const lNum = parseFloat(l) / 100;
  const a = sNum * Math.min(lNum, 1 - lNum);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = lNum - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getDefaultBrand(): BrandConfig {
  if (!defaultBrand) {
    defaultBrand = JSON.parse(fs.readFileSync(DEFAULT_PATH, 'utf-8')) as BrandConfig;
  }
  return defaultBrand;
}
