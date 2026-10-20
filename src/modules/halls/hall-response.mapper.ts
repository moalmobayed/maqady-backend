import { formatCairoIso } from '../../common/time/time';
import {
  HallLayoutResponse,
  HallLayoutRowResponse,
  SeatMarkResponse,
} from './dto/hall-layout.response';
import { HallResponse } from './dto/hall.response';
import { ZoneSeatCountsResponse } from './dto/zone-seat-counts.response';
import type { HallAdminView, HallLayout, ZoneSeatCounts } from './types';

/** Response DTOs of halls and layouts; `toHallLayoutResponse` is reused by U8 and U10. */

export function toZoneSeatCountsResponse(counts: ZoneSeatCounts): ZoneSeatCountsResponse {
  return Object.assign(new ZoneSeatCountsResponse(), {
    front: counts.front,
    middle: counts.middle,
    back: counts.back,
  });
}

export function toHallResponse(hall: HallAdminView): HallResponse {
  return Object.assign(new HallResponse(), {
    id: hall.id,
    theaterId: hall.theaterId,
    name: hall.name,
    status: hall.status,
    rowCount: hall.rowCount,
    seatsPerRow: hall.seatsPerRow,
    seatCount: hall.seatCount,
    wheelchairCount: hall.wheelchairCount,
    zoneSeatCounts: toZoneSeatCountsResponse(hall.zoneSeatCounts),
    deletable: hall.deletable,
    createdAt: formatCairoIso(hall.createdAt),
    updatedAt: formatCairoIso(hall.updatedAt),
  });
}

export function toHallLayoutResponse(layout: HallLayout): HallLayoutResponse {
  return Object.assign(new HallLayoutResponse(), {
    hallId: layout.hallId,
    rowCount: layout.rowCount,
    seatsPerRow: layout.seatsPerRow,
    aisleAfter: [...layout.aisleAfter],
    rows: layout.rows.map((row) =>
      Object.assign(new HallLayoutRowResponse(), { label: row.label, zone: row.zone }),
    ),
    seatMarks: layout.seatMarks.map((mark) =>
      Object.assign(new SeatMarkResponse(), {
        rowLabel: mark.rowLabel,
        seatNumber: mark.seatNumber,
        kind: mark.kind,
      }),
    ),
    seatCount: layout.seatCount,
    wheelchairCount: layout.wheelchairCount,
    zoneSeatCounts: toZoneSeatCountsResponse(layout.zoneSeatCounts),
    updatedAt: formatCairoIso(layout.updatedAt),
  });
}
