import type { HEALTH_STATUSES } from './enums';

export type HealthStatus = (typeof HEALTH_STATUSES)[number];
