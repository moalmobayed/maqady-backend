import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Staff } from '../../common/auth/access.decorators';
import type { StaffPrincipal } from '../../common/auth/types';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { BookingResponseMapper } from './booking-response.mapper';
import { SCAN_OPENS_MINUTES_BEFORE_START } from './bookings.constants';
import { ScanResultResponse } from './dto/scan-result.response';
import { ScanRequest } from './dto/scan.request';
import { ScanService } from './scan.service';
import { SettleFirst } from './settle-first.decorator';
import type { ScanInput } from './types';

/** Ticket scanning at the entrance (design §7.9, §11; PRD "Scan tickets"). Both staff roles. */
@ApiTags('Admin: scans')
@Controller('admin/scans')
export class ScansController {
  constructor(
    private readonly scans: ScanService,
    private readonly mapper: BookingResponseMapper,
  ) {}

  @Post()
  @Staff()
  @SettleFirst('booking', 'body')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Scan a ticket at the entrance',
    description: `Staff (box office or admin): the Scan tickets screen. Send the theater the entrance belongs to and the ticket: \`code\`, the QR code's text as the camera read it, or \`reference\`, typed by hand when the camera fails. No \`Idempotency-Key\` is needed: a scan is naturally idempotent (a repeat answers \`ALREADY_USED\`).\n\nEvery ticket outcome is \`200\` with a \`result\`, never an error:\n\n- \`VALID\` ("Valid · Admits n"): the booking is checked in now, once for all its seats (one QR code admits the whole booking).\n- \`ALREADY_USED\` ("Already used at 19:12"): checked in before, at \`checkedInAt\`.\n- \`WRONG_SHOWTIME\` with \`reason\`: \`other_theater\`, \`cancelled\`, \`not_open_yet\` (scanning opens ${SCAN_OPENS_MINUTES_BEFORE_START} minutes before the start) or \`ended\` (it closes when the showtime ends).\n- \`NOT_VALID\` with \`reason\`: \`refunded\`, \`not_paid\` (a hold), or \`replaced\` (an older QR code, voided by an edit).\n- \`NOT_FOUND\`: not a Maqady ticket (another QR code, a tampered or forged one: the signature is verified) or no such reference.\n- \`CONFIRM_REQUIRED\`: a typed reference. The booking is shown (showtime, seats, contact name) but nobody is admitted: compare it with the customer, then send the same reference with \`confirm: true\` to check it in. The reference alone admits nobody. A typed reference's due online payment is settled first, so a booking paid with a slow method reads as paid.\n\nThe checks run in that order: theater, cancellation, payment, QR version, window, then the earlier scan. Two scans of one ticket at once admit it exactly once. A check-in is recorded in the activity log with the member who scanned it. An unknown \`theaterId\`: \`NOT_FOUND\` (an error).`,
  })
  @ApiBody({ type: ScanRequest })
  @ApiOkResponse({
    type: ScanResultResponse,
    description: 'The scan result',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async scan(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Body() body: ScanRequest,
  ): Promise<ScanResultResponse> {
    return this.mapper.scanResult(await this.scans.scan(principal, scanInputOf(body)));
  }
}

/** The validated request, as the service takes it: a QR code, or a typed reference. */
function scanInputOf(body: ScanRequest): ScanInput {
  if (body.code !== undefined) return { theaterId: body.theaterId, via: 'qr', code: body.code };
  return {
    theaterId: body.theaterId,
    via: 'reference',
    reference: body.reference!,
    confirm: body.confirm === true,
  };
}
