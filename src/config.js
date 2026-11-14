import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  AMAZON_ORDER_ID: z.string().regex(/^$|^[0-9]{3}-[0-9]{7}-[0-9]{7}$/).default(''),
  AMAZON_ORDER_ASIN: z.string().default(''),
  AMAZON_ORDER_URL: z.string().url().optional(),
  CHECK_INTERVAL_MINUTES: z.coerce.number().int().min(10).default(10),
  DB_PATH: z.string().default('./data/watcher.sqlite'),
  AMAZON_PROFILE_DIR: z.string().default('./data/amazon-profile'),
  ADB_EXECUTABLE: z.string().default(''),
  ADB_SERIAL: z.string().default(''),
  ADB_FORWARD_PORT: z.coerce.number().int().min(1024).max(65535).default(18761),
  TAILSCALE_NOTIFY_URL: z.string().url().optional(),
  TAILSCALE_TOKEN: z.string().min(24).optional(),
  LOG_LEVEL: z.enum(['debug','info','warn','error']).default('info'),
});

const raw = schema.parse(process.env);
if (raw.AMAZON_ORDER_URL && !/^https:\/\/(www\.)?amazon\.com\.br\//i.test(raw.AMAZON_ORDER_URL))
  throw new Error('AMAZON_ORDER_URL deve ser uma URL HTTPS da Amazon Brasil');
export const config = {
  ...raw,
  orderId: raw.AMAZON_ORDER_ID,
  asin: raw.AMAZON_ORDER_ASIN,
  orderUrl: raw.AMAZON_ORDER_URL || (raw.AMAZON_ORDER_ID
    ? `https://www.amazon.com.br/gp/your-account/order-details?orderID=${encodeURIComponent(raw.AMAZON_ORDER_ID)}`
    : ''),
  profileDir: path.resolve(raw.AMAZON_PROFILE_DIR),
  dbPath: path.resolve(raw.DB_PATH),
};
