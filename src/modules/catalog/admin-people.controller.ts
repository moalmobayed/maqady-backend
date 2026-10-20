import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Admin, CurrentPrincipal } from '../../common/auth/access.decorators';
import type { StaffPrincipal } from '../../common/auth/types';
import { Strict } from '../../common/idempotency/idempotency.decorators';
import { toPageRequest } from '../../common/pagination/cursor';
import type { Page } from '../../common/pagination/types';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { ImageUpload, UploadedImage } from '../media/image-upload.decorators';
import type { ImageUploadPayload, UploadOutcome } from '../media/types';
import { CatalogResponseMapper } from './catalog-response.mapper';
import { CreditsService } from './credits.service';
import { AdminPersonListQuery } from './dto/admin-person-list.query';
import {
  AdminPersonListItemResponse,
  AdminPersonPage,
} from './dto/admin-person-list-item.response';
import { AdminPersonResponse } from './dto/admin-person.response';
import { CreatePersonRequest } from './dto/create-person.request';
import { PersonIdParams } from './dto/person-id.params';
import { ReplacePersonCreditsRequest } from './dto/replace-person-credits.request';
import { UpdatePersonRequest } from './dto/update-person.request';
import { PeopleService } from './people.service';

const ADMIN_ONLY = 'Admin only (box office staff get `FORBIDDEN`).';

@ApiTags('Admin: people')
@Controller('admin/people')
export class AdminPeopleController {
  constructor(
    private readonly people: PeopleService,
    private readonly credits: CreditsService,
    private readonly mapper: CatalogResponseMapper,
  ) {}

  @Get()
  @Admin()
  @ApiOperation({
    summary: 'List people',
    description: `${ADMIN_ONLY} The People screen: actors and crew by name, with photo, roles, birth year and place, credit count and up to two movies they are known for.\n\n- \`q\` matches part of the name, case-insensitively.\n- \`roleGroup\`: Actors (actor, voice), Directors, Writers or Crew (producer, cinematographer, composer), by a role set on the person or one they are credited in.\n- Cursor-paginated: pass \`nextCursor\` back as \`cursor\`.`,
  })
  @ApiOkResponse({
    type: AdminPersonPage,
    description: 'One page of people',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED')
  async listPeople(
    @Query() query: AdminPersonListQuery,
  ): Promise<Page<AdminPersonListItemResponse>> {
    const page = await this.people.list(
      {
        ...(query.q !== undefined ? { q: query.q } : {}),
        ...(query.roleGroup !== undefined ? { roleGroup: query.roleGroup } : {}),
      },
      toPageRequest(query, 'text'),
    );
    return { ...page, items: page.items.map((item) => this.mapper.adminPersonListItem(item)) };
  }

  @Post()
  @Admin()
  @Strict()
  @ApiOperation({
    summary: 'Create a person',
    description: `${ADMIN_ONLY} Adds an actor or crew member, managed once and credited on many movies. Only \`fullName\` is required. Social links must be https; Instagram and IMDb links must be on their own sites. Requires an \`Idempotency-Key\`. Recorded in the activity log.`,
  })
  @ApiBody({ type: CreatePersonRequest })
  @ApiCreatedResponse({
    type: AdminPersonResponse,
    description: 'The new person',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED')
  async createPerson(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Body() body: CreatePersonRequest,
  ): Promise<AdminPersonResponse> {
    const person = await this.people.create(principal, {
      fullName: body.fullName,
      ...personDetailsOf(body),
    });
    return this.mapper.adminPerson(person);
  }

  @Get(':id')
  @Admin()
  @ApiOperation({
    summary: 'Get a person for the editor',
    description: `${ADMIN_ONLY} The person's details, links, the roles set on them, the roles they are credited in, and their filmography (newest release first).`,
  })
  @ApiOkResponse({
    type: AdminPersonResponse,
    description: 'The person',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async getPerson(@Param() params: PersonIdParams): Promise<AdminPersonResponse> {
    return this.mapper.adminPerson(await this.people.get(params.id));
  }

  @Patch(':id')
  @Admin()
  @ApiOperation({
    summary: 'Edit a person',
    description: `${ADMIN_ONLY} Changes any details, links or set roles. Absent fields stay; null clears a nullable one. A birth date in the future is \`VALIDATION_FAILED\`. A change to the values the person already has answers \`200\` and changes nothing. Recorded in the activity log with the names of the changed fields.`,
  })
  @ApiBody({ type: UpdatePersonRequest })
  @ApiOkResponse({
    type: AdminPersonResponse,
    description: 'The person after the change',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async updatePerson(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: PersonIdParams,
    @Body() body: UpdatePersonRequest,
  ): Promise<AdminPersonResponse> {
    const person = await this.people.update(principal, params.id, {
      ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
      ...personDetailsOf(body),
    });
    return this.mapper.adminPerson(person);
  }

  @Delete(':id')
  @Admin()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a person',
    description: `${ADMIN_ONLY} Deletes the person with their roles and **every credit** on every movie; those movies' cast lists close the gaps. The photo's files go once the deletion commits. Recorded in the activity log with the number of credits removed.`,
  })
  @ApiNoContentResponse({ description: 'Deleted', headers: REQUEST_ID_RESPONSE_HEADER })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async deletePerson(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: PersonIdParams,
  ): Promise<void> {
    await this.people.delete(principal, params.id);
  }

  @Put(':id/photo')
  @Admin()
  @HttpCode(200)
  @ImageUpload()
  @ApiOperation({
    summary: "Upload a person's photo",
    description: `${ADMIN_ONLY} Sets the photo from one JPG or PNG of at most 10 MB: square (up to 2 % off, centre-cropped) and at least 600 × 600, else \`IMAGE_WRONG_SHAPE\`. Replaces any previous photo, whose files are deleted once the change commits. An unknown person is \`NOT_FOUND\` before the image is processed. The optional \`Idempotency-Key\` replays a retried upload. Recorded in the activity log.`,
  })
  @ApiOkResponse({
    type: AdminPersonResponse,
    description: 'The person with the new photo',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('NOT_FOUND')
  async uploadPersonPhoto(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: PersonIdParams,
    @UploadedImage() upload: ImageUploadPayload,
  ): Promise<UploadOutcome<AdminPersonResponse>> {
    return this.people.uploadPhoto(principal, params.id, upload, (person) =>
      this.mapper.adminPerson(person),
    );
  }

  @Delete(':id/photo')
  @Admin()
  @HttpCode(204)
  @ApiOperation({
    summary: "Remove a person's photo",
    description: `${ADMIN_ONLY} Removes the photo and deletes its files once the change commits. A person without a photo answers \`204\` too. Recorded in the activity log.`,
  })
  @ApiNoContentResponse({ description: 'Removed', headers: REQUEST_ID_RESPONSE_HEADER })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async removePersonPhoto(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: PersonIdParams,
  ): Promise<void> {
    await this.people.removePhoto(principal, params.id);
  }

  @Put(':id/credits')
  @Admin()
  @ApiOperation({
    summary: "Replace a person's filmography",
    description: `${ADMIN_ONLY} Edits the person's credits from their side: the whole list, each movie and role once. A credit that stays keeps its place in the movie's cast list and takes the new character name; a new one goes last in its movie's list; one left out is removed. \`characterName\` is only for \`actor\` and \`voice\`. An unknown movie is \`VALIDATION_FAILED\` on \`credits.<i>.movieId\`; a movie that would pass 200 credits is \`CONFLICT\`. Recorded in the activity log.`,
  })
  @ApiBody({ type: ReplacePersonCreditsRequest })
  @ApiOkResponse({
    type: AdminPersonResponse,
    description: 'The person with the new filmography',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'CONFLICT')
  async replacePersonCredits(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: PersonIdParams,
    @Body() body: ReplacePersonCreditsRequest,
  ): Promise<AdminPersonResponse> {
    const person = await this.credits.replaceForPerson(
      principal,
      params.id,
      body.credits.map((credit) => ({
        movieId: credit.movieId,
        role: credit.role,
        characterName: credit.characterName ?? null,
      })),
    );
    return this.mapper.adminPerson(person);
  }
}

/** The detail fields a create or update request sent. */
function personDetailsOf(body: CreatePersonRequest | UpdatePersonRequest) {
  return {
    ...(body.birthDate !== undefined ? { birthDate: body.birthDate } : {}),
    ...(body.birthPlace !== undefined ? { birthPlace: body.birthPlace } : {}),
    ...(body.nationality !== undefined ? { nationality: body.nationality } : {}),
    ...(body.bio !== undefined ? { bio: body.bio } : {}),
    ...(body.instagramUrl !== undefined ? { instagramUrl: body.instagramUrl } : {}),
    ...(body.imdbUrl !== undefined ? { imdbUrl: body.imdbUrl } : {}),
    ...(body.websiteUrl !== undefined ? { websiteUrl: body.websiteUrl } : {}),
    ...(body.roles !== undefined ? { roles: body.roles } : {}),
  };
}
